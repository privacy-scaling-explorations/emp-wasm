#ifndef EMP_BRISTOL_FORMAT_H
#define EMP_BRISTOL_FORMAT_H

#include "emp-tool/execution/circuit_execution.h"
#include "emp-tool/execution/protocol_execution.h"
#include "emp-tool/utils/block.h"
#include "emp-tool/circuits/bit.h"
#include <stdio.h>
#include <fstream>

using std::vector;

namespace emp {
#define AND_GATE 0
#define XOR_GATE 1
#define NOT_GATE 2

template<typename T>
void execute_circuit(block * wires, const T * gates, size_t num_gate) {
    for(size_t i = 0; i < num_gate; ++i) {
        if(gates[4*i+3] == AND_GATE) {
            wires[gates[4*i+2]] = CircuitExecution::circ_exec->and_gate(wires[gates[4*i]], wires[gates[4*i+1]]);
        }
        else if (gates[4*i+3] == XOR_GATE) {
            wires[gates[4*i+2]] = CircuitExecution::circ_exec->xor_gate(wires[gates[4*i]], wires[gates[4*i+1]]);
        }
        else if (gates[4*i+3] == NOT_GATE) {
            wires[gates[4*i+2]] = CircuitExecution::circ_exec->not_gate(wires[gates[4*i]]);
        } else {
            block tmp = CircuitExecution::circ_exec->xor_gate(wires[gates[4*i]],  wires[gates[4*i+1]]);
            block tmp2 = CircuitExecution::circ_exec->and_gate(wires[gates[4*i]], wires[gates[4*i+1]]);
            wires[gates[4*i+2]] = CircuitExecution::circ_exec->xor_gate(tmp, tmp2);
        }
    }
}


class BristolFormat {
public:
    int num_gate, num_wire, n1, n2, n3;
    std::vector<int> gates;
    std::vector<block> wires;
    std::ofstream fout;

    BristolFormat() {}

    BristolFormat(int num_gate, int num_wire, int n1, int n2, int n3, int* gate_arr) {
        this->num_gate = num_gate;
        this->num_wire = num_wire;
        this->n1 = n1;
        this->n2 = n2;
        this->n3 = n3;
        gates.resize(num_gate * 4);
        wires.resize(num_wire);
        memcpy(gates.data(), gate_arr, num_gate * 4 * sizeof(int));
    }

    BristolFormat(const char* file) {
        this->from_file(file);
    }

    void from_file(const char* file) {
        std::ifstream file_stream(file);
        if (!file_stream.is_open()) {
            throw std::runtime_error("Cannot open file");
        }
        from_stream(file_stream);
    }

    void from_str(const char* input) {
        std::istringstream string_stream(input);
        from_stream(string_stream);
    }

    void to_file(const char* filename, const char* prefix) {
        fout.open(filename);
        fout << "int " << std::string(prefix) + "_num_gate = " << num_gate << ";\n";
        fout << "int " << std::string(prefix) + "_num_wire = " << num_wire << ";\n";
        fout << "int " << std::string(prefix) + "_n1 = " << n1 << ";\n";
        fout << "int " << std::string(prefix) + "_n2 = " << n2 << ";\n";
        fout << "int " << std::string(prefix) + "_n3 = " << n3 << ";\n";
        fout << "int " << std::string(prefix) + "_gate_arr [" << num_gate * 4 << "] = {\n";
        for (int i = 0; i < num_gate; ++i) {
            for (int j = 0; j < 4; ++j)
                fout << gates[4 * i + j] << ", ";
            fout << "\n";
        }
        fout << "};\n";
        fout.close();
    }

    /*  Consume the binary layout produced by bristolToBinary.
    *  ┌────────────┬──────────────────────────────────────────────────┐
    *  │ bytes 0-19 │ five uint32  (num_gate, num_wire, n1, n2, n3)    │
    *  │ …          │ repeated records                                 │
    *  │            │   1 byte  opcode (0 INV, 1 XOR, 2 AND)           │
    *  │            │   INV : 2 × uint32  (in , out)          ──  9 B  │
    *  │            │   XOR/AND: 3 × uint32 (in1,in2,out)     ── 13 B  │
    *  └────────────┴──────────────────────────────────────────────────┘
    *  Any deviation throws std::runtime_error.
    */
    void from_buffer(const uint8_t* buf, int size) {
        auto need = [&](size_t n) {
            if (n > static_cast<size_t>(size))
                throw std::runtime_error("Buffer too small / truncated");
        };

        auto read_u32 = [&](const uint8_t* p) -> uint32_t {
            return  static_cast<uint32_t>(p[0]) |
                (static_cast<uint32_t>(p[1]) <<  8) |
                (static_cast<uint32_t>(p[2]) << 16) |
                (static_cast<uint32_t>(p[3]) << 24);
        };

        /* ---------- header ---------- */
        need(20);
        num_gate = static_cast<int>(read_u32(buf + 0));
        num_wire = static_cast<int>(read_u32(buf + 4));
        n1       = static_cast<int>(read_u32(buf + 8));
        n2       = static_cast<int>(read_u32(buf + 12));
        n3       = static_cast<int>(read_u32(buf + 16));

        gates.resize(num_gate * 4);
        wires.resize(num_wire);

        size_t offset = 20;
        for (int g = 0; g < num_gate; ++g) {
            need(offset + 1);                              // opcode byte
            uint8_t opcode = buf[offset++];
            switch (opcode) {
                case 0: {  // INV
                    need(offset + 8);
                    int in  = static_cast<int>(read_u32(buf + offset));     offset += 4;
                    int out = static_cast<int>(read_u32(buf + offset));     offset += 4;

                    gates[4 * g]     = in;
                    gates[4 * g + 1] = 0;   // unused
                    gates[4 * g + 2] = out;
                    gates[4 * g + 3] = NOT_GATE;
                    break;
                }
                case 1:      // XOR
                case 2: {    // AND
                    need(offset + 12);
                    int in1 = static_cast<int>(read_u32(buf + offset));     offset += 4;
                    int in2 = static_cast<int>(read_u32(buf + offset));     offset += 4;
                    int out = static_cast<int>(read_u32(buf + offset));     offset += 4;

                    gates[4 * g]     = in1;
                    gates[4 * g + 1] = in2;
                    gates[4 * g + 2] = out;
                    gates[4 * g + 3] = (opcode == 1) ? XOR_GATE : AND_GATE;
                    break;
                }
                default:
                    throw std::runtime_error("Unknown gate opcode");
            }
        }

        if (offset != static_cast<size_t>(size))
            throw std::runtime_error("Extra bytes after final gate");
    }

    void compute(Bit* out, const Bit* in1, const Bit* in2) {
        compute((block*)out, (block*)in1, (block*)in2);
    }

    void compute(block* out, const block* in1, const block* in2) {
        memcpy(wires.data(), in1, n1 * sizeof(block));
        memcpy(wires.data() + n1, in2, n2 * sizeof(block));
        for (int i = 0; i < num_gate; ++i) {
            if (gates[4 * i + 3] == AND_GATE) {
                wires[gates[4 * i + 2]] = CircuitExecution::circ_exec->and_gate(wires[gates[4 * i]], wires[gates[4 * i + 1]]);
            } else if (gates[4 * i + 3] == XOR_GATE) {
                wires[gates[4 * i + 2]] = CircuitExecution::circ_exec->xor_gate(wires[gates[4 * i]], wires[gates[4 * i + 1]]);
            } else {
                wires[gates[4 * i + 2]] = CircuitExecution::circ_exec->not_gate(wires[gates[4 * i]]);
            }
        }
        memcpy(out, wires.data() + (num_wire - n3), n3 * sizeof(block));
    }

private:
    void from_stream(std::istream& stream) {
        int tmp;
        stream >> num_gate >> num_wire;
        stream >> n1 >> n2 >> n3;

        gates.resize(num_gate * 4);
        wires.resize(num_wire);

        for (int i = 0; i < num_gate; ++i) {
            stream >> tmp;
            if (tmp == 2) {
                stream >> tmp >> gates[4 * i] >> gates[4 * i + 1] >> gates[4 * i + 2];
                std::string gate_type;
                stream >> gate_type;
                if (gate_type[0] == 'A') gates[4 * i + 3] = AND_GATE;
                else if (gate_type[0] == 'X') gates[4 * i + 3] = XOR_GATE;
            } else if (tmp == 1) {
                stream >> tmp >> gates[4 * i] >> gates[4 * i + 2];
                std::string gate_type;
                stream >> gate_type;
                gates[4 * i + 3] = NOT_GATE;
            }
        }
    }
};

class BristolFashion { public:
    int num_gate = 0, num_wire = 0,
         num_input = 0, num_output = 0;
    vector<int> gates;
    vector<block> wires;

    BristolFashion(FILE * file) {
        this->from_file(file);
    }

    BristolFashion(const char * file) {
        this->from_file(file);
    }

    void from_file(FILE * f) {
        int tmp;
        (void)fscanf(f, "%d%d\n", &num_gate, &num_wire);
        int niov = 0;
        (void)fscanf(f, "%d", &niov);
        for(int i = 0; i < niov; ++i) {
            (void)fscanf(f, "%d", &tmp);
            num_input += tmp;
        }
        (void)fscanf(f, "%d", &niov);
        for(int i = 0; i < niov; ++i) {
            (void)fscanf(f, "%d", &tmp);
            num_output += tmp;
        }

        char str[10];
        gates.resize(num_gate*4);
        wires.resize(num_wire);
        for(int i = 0; i < num_gate; ++i) {
            (void)fscanf(f, "%d", &tmp);
            if (tmp == 2) {
                (void)fscanf(f, "%d%d%d%d%s", &tmp, &gates[4*i], &gates[4*i+1], &gates[4*i+2], str);
                if (str[0] == 'A') gates[4*i+3] = AND_GATE;
                else if (str[0] == 'X') gates[4*i+3] = XOR_GATE;
            }
            else if (tmp == 1) {
                (void)fscanf(f, "%d%d%d%s", &tmp, &gates[4*i], &gates[4*i+2], str);
                gates[4*i+3] = NOT_GATE;
            }
        }
    }

    void from_file(const char * file) {
        FILE * f = fopen(file, "r");
        this->from_file(f);
        fclose(f);
    }

    void compute(Bit * out, const Bit * in) {
        compute((block*)out, (block *)in);
    }
    void compute(block * out, const block * in) {
        memcpy(wires.data(), in, num_input*sizeof(block));
        for(int i = 0; i < num_gate; ++i) {
            if(gates[4*i+3] == AND_GATE) {
                wires[gates[4*i+2]] = CircuitExecution::circ_exec->and_gate(wires[gates[4*i]], wires[gates[4*i+1]]);
            }
            else if (gates[4*i+3] == XOR_GATE) {
                wires[gates[4*i+2]] = CircuitExecution::circ_exec->xor_gate(wires[gates[4*i]], wires[gates[4*i+1]]);
            }
            else
                wires[gates[4*i+2]] = CircuitExecution::circ_exec->not_gate(wires[gates[4*i]]);
        }
        memcpy(out, wires.data()+(num_wire-num_output), num_output*sizeof(block));
    }
};

}
#endif// CIRCUIT_FILE
