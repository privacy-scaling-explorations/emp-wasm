#include <emscripten.h>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>

#include "emp-tool/io/i_raw_io.h"
#include "emp-ag2pc/2pc.h"
#include "emp-agmpc/mpc.h"

void run_2pc_impl(int party, int nP);
void run_mpc_impl(int party, int nP);

// Implement send_js function to send data from C++ to JavaScript
EM_JS(void, send_js, (int to_party, char channel_label, const void* data, size_t len), {
    if (!Module.emp?.io?.send) {
        throw new Error("Module.emp.io.send is not defined in JavaScript.");
    }

    // Copy data from WebAssembly memory to a JavaScript Uint8Array
    const dataArray = HEAPU8.slice(data, data + len);

    Module.emp.io.send(to_party - 1, String.fromCharCode(channel_label), dataArray);
});

// Implement recv_js function to receive data from JavaScript to C++
EM_ASYNC_JS(void, recv_js, (int from_party, char channel_label, void* data, size_t len), {
    if (!Module.emp?.io?.recv) {
        reject(new Error("Module.emp.io.recv is not defined in JavaScript."));
        return;
    }

    // Wait for data from JavaScript
    const dataArray = await Module.emp.io.recv(from_party - 1, String.fromCharCode(channel_label), len);

    // Copy data from JavaScript Uint8Array to WebAssembly memory
    HEAPU8.set(dataArray, data);
});

class RawIOJS : public IRawIO {
public:
    int other_party;
    char channel_label;

    RawIOJS(
        int other_party,
        char channel_label
    ):
        other_party(other_party),
        channel_label(channel_label)
    {}

    void send(const void* data, size_t len) override {
        send_js(other_party, channel_label, data, len);
    }

    void recv(void* data, size_t len) override {
        recv_js(other_party, channel_label, data, len);
    }

    void flush() override {
        // Ignored for now
    }
};

class MultiIOJS : public IMultiIO {
public:
    int mParty;
    int nP;

    std::vector<emp::IOChannel> a_channels;
    std::vector<emp::IOChannel> b_channels;

    MultiIOJS(int party, int nP) : mParty(party), nP(nP) {
        for (int i = 0; i <= nP; i++) {
            a_channels.emplace_back(std::make_shared<RawIOJS>(i, 'a'));
            b_channels.emplace_back(std::make_shared<RawIOJS>(i, 'b'));
        }
    }

    int size() override {
        return nP;
    }

    int party() override {
        return mParty;
    }

    emp::IOChannel& a_channel(int other_party) override {
        assert(other_party != 0);
        assert(other_party != party());

        return a_channels[other_party];
    }

    emp::IOChannel& b_channel(int other_party) override {
        assert(other_party != 0);
        assert(other_party != party());

        return b_channels[other_party];
    }

    void flush(int idx) override {
        assert(idx != 0);

        if (party() < idx)
            a_channels[idx].flush();
        else
            b_channels[idx].flush();
    }
};

EM_JS(char*, get_circuit_raw, (int* lengthPtr), {
    if (!Module.emp?.circuit) {
        throw new Error("Module.emp.circuit is not defined in JavaScript.");
    }

    const circuitString = Module.emp.circuit; // Get the string from JavaScript
    const length = lengthBytesUTF8(circuitString) + 1; // Calculate length including the null terminator

    // Allocate memory for the string
    const strPtr = Module._js_char_malloc(length);
    stringToUTF8(circuitString, strPtr, length);

    // Set the length at the provided pointer location
    setValue(lengthPtr, length, 'i32');

    // Return the pointer
    return strPtr;
});

emp::BristolFormat get_circuit() {
    int length = 0;
    char* circuit_raw = get_circuit_raw(&length);

    emp::BristolFormat circuit;
    circuit.from_str(circuit_raw);
    free(circuit_raw);

    return circuit;
}

EM_JS(uint8_t*, get_input_bits_raw, (int* lengthPtr), {
    if (!Module.emp?.inputBits) {
        throw new Error("Module.emp.inputBits is not defined in JavaScript.");
    }

    const inputBits = Module.emp.inputBits; // Assume this is a Uint8Array

    // Allocate memory for the inputBits array
    const bytePtr = Module._js_malloc(inputBits.length);
    Module.HEAPU8.set(inputBits, bytePtr);

    // Set the length at the provided pointer location
    setValue(lengthPtr, inputBits.length, 'i32');

    // Return the pointer
    return bytePtr;
});

std::vector<bool> get_input_bits() {
    int length = 0;
    uint8_t* input_bits_raw = get_input_bits_raw(&length);

    std::vector<bool> input_bits(length);

    for (int i = 0; i < length; ++i) {
        input_bits[i] = input_bits_raw[i];
    }

    free(input_bits_raw);

    return input_bits;
}

EM_JS(size_t, get_input_bits_per_party, (int i), {
    if (!Module.emp?.inputBitsPerParty) {
        throw new Error("Module.emp.inputBitsPerParty is not defined in JavaScript.");
    }

    if (i >= Module.emp.inputBitsPerParty.length) {
        throw new Error("Index out of bounds for Module.emp.inputBitsPerParty.");
    }

    const res = Module.emp.inputBitsPerParty[i];

    if (res < 0) {
        throw new Error("Negative value for Module.emp.inputBitsPerParty.");
    }

    return res;
});

EM_JS(void, handle_output_bits_raw, (uint8_t* outputBits, int length), {
    if (!Module.emp?.handleOutput) {
        throw new Error("Module.emp.handleOutput is not defined in JavaScript.");
    }

    // Copy the output bits to a Uint8Array
    const outputBitsArray = new Uint8Array(Module.HEAPU8.buffer, outputBits, length);

    // Call the JavaScript function with the output bits
    Module.emp.handleOutput(outputBitsArray.slice());
});

EM_JS(void, handle_error, (const char* message), {
    if (!Module.emp?.handleError) {
        throw new Error("Module.emp.handleError is not defined in JavaScript.");
    }

    Module.emp.handleError(new Error(UTF8ToString(message)));
});

void handle_output_bits(const std::vector<bool>& output_bits) {
    uint8_t* output_bits_raw = new uint8_t[output_bits.size()];

    for (size_t i = 0; i < output_bits.size(); ++i) {
        output_bits_raw[i] = output_bits[i];
    }

    handle_output_bits_raw(output_bits_raw, output_bits.size());

    delete[] output_bits_raw;
}

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void run_2pc(int party, int size) {
        run_2pc_impl(party + 1, size);
    }

    EMSCRIPTEN_KEEPALIVE
    void run_mpc(int party, int size) {
        run_mpc_impl(party + 1, size);
    }

    EMSCRIPTEN_KEEPALIVE
    uint8_t* js_malloc(int size) {
        return (uint8_t*)malloc(size);
    }

    EMSCRIPTEN_KEEPALIVE
    char* js_char_malloc(int size) {
        return (char*)malloc(size);
    }
}

void run_2pc_impl(int party, int nP) {
    if (nP != 2) {
        throw std::runtime_error("2PC only supports 2 parties");
    }

    if (party != 1 && party != 2) {
        throw std::runtime_error("Invalid party number");
    }

    try {
        int other_party = (party == 1) ? 2 : 1;

        auto io = emp::IOChannel(std::make_shared<RawIOJS>(other_party, 'a'));
        auto circuit = get_circuit();
        std::vector<bool> input_bits = get_input_bits();

        {
            size_t circuit_input_count = (party == 1) ? circuit.n1 : circuit.n2;

            if (input_bits.size() != circuit_input_count) {
                throw std::runtime_error("Mismatch between circuit and inputBits");
            }
        }

        for (int p = 0; p < 2; p++) {
            size_t input_count = get_input_bits_per_party(p);
            size_t circuit_input_count = (p == 0) ? circuit.n1 : circuit.n2;

            if (input_count != circuit_input_count) {
                throw std::runtime_error("Mismatch between circuit and inputBitsPerParty");
            }
        }

        auto twopc = emp::C2PC(io, party, &circuit);

        twopc.function_independent();
        twopc.function_dependent();

        std::vector<bool> output_bits = twopc.online(input_bits, true);
        handle_output_bits(output_bits);
    } catch (const std::exception& e) {
        handle_error(e.what());
    }
}

void run_mpc_impl(int party, int nP) {
    try {
        std::shared_ptr<IMultiIO> io = std::make_shared<MultiIOJS>(party, nP);
        auto circuit = get_circuit();
        auto mpc = CMPC(io, &circuit);

        mpc.function_independent();
        mpc.function_dependent();

        std::vector<bool> input_bits = get_input_bits();

        FlexIn input(nP, circuit.n1 + circuit.n2, party);

        int bit_pos = 0;
        for (int p = 0; p < nP; p++) {
            size_t input_count = get_input_bits_per_party(p);

            if (p + 1 == party) {
                assert(input_count == input_bits.size());
            }

            for (size_t i = 0; i < input_count; i++) {
                input.assign_party(bit_pos, p + 1);

                if (p + 1 == party) {
                    input.assign_plaintext_bit(bit_pos, input_bits[i]);
                }

                bit_pos++;
            }
        }

        assert(bit_pos == circuit.n1 + circuit.n2);

        FlexOut output(nP, circuit.n3, party);

        for (int i = 0; i < circuit.n3; i++) {
            // All parties receive the output.
            output.assign_party(i, 0);
        }

        mpc.online(&input, &output);

        std::vector<bool> output_bits;

        for (int i = 0; i < circuit.n3; i++) {
            output_bits.push_back(output.get_plaintext_bit(i));
        }

        handle_output_bits(output_bits);
    } catch (const std::exception& e) {
        handle_error(e.what());
    }
}

int main() {
    return 0;
}
