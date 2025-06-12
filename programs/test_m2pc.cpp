#include <emp-tool/emp-tool.h>
#include "emp-agmpc/emp-agmpc.h"
using namespace std;
using namespace emp;

const string circuit_file_location = "circuits/sha-1.txt";;

std::string binary_to_hex(const std::string& bin);

int main(int argc, char** argv) {
    int port, party;
    parse_party_and_port(argv, &party, &port);

    const static int nP = 2;
    std::shared_ptr<IMultiIO> io = std::make_shared<NetIOMP>(nP, party, port);
    BristolFormat cf(circuit_file_location.c_str());

    CMPC* mpc = new CMPC(io, &cf);
    cout <<"Setup:\t"<<party<<"\n";

    mpc->function_independent();
    cout <<"FUNC_IND:\t"<<party<<"\n";

    mpc->function_dependent();
    cout <<"FUNC_DEP:\t"<<party<<"\n";

    // The split of input into n1 and n2 is meaningless here,
    // what matters is that there are n1+n2 input bits.
    FlexIn input(nP, cf.n1 + cf.n2, party);

    for (int i = 0; i < cf.n1 + cf.n2; i++) {
        input.assign_party(i, 1);

        if (party == 1) {
            input.assign_plaintext_bit(i, i == 0);
        }
    }

    FlexOut output(nP, cf.n3, party);

    for (int i = 0; i < cf.n3; i++) {
        // All parties receive the output.
        output.assign_party(i, 0);
    }

    mpc->online(&input, &output);
    uint64_t band2 = count_multi_io(*io);
    cout <<"bandwidth\t"<<party<<"\t"<<band2<<endl;
    cout <<"ONLINE:\t"<<party<<"\n";

    string res = "";
    for(int i = 0; i < cf.n3; ++i)
        res += (output.get_plaintext_bit(i)?"1":"0");
    cout << binary_to_hex(res) <<endl;

    delete mpc;
    return 0;
}

std::string binary_to_hex(const std::string& bin) {
    if (bin.length() % 4 != 0) {
        throw std::invalid_argument("Binary string length must be a multiple of 4");
    }

    std::string hex;
    for (std::size_t i = 0; i < bin.length(); i += 4) {
        std::string chunk = bin.substr(i, 4);
        if (chunk == "0000") hex += '0';
        else if (chunk == "0001") hex += '1';
        else if (chunk == "0010") hex += '2';
        else if (chunk == "0011") hex += '3';
        else if (chunk == "0100") hex += '4';
        else if (chunk == "0101") hex += '5';
        else if (chunk == "0110") hex += '6';
        else if (chunk == "0111") hex += '7';
        else if (chunk == "1000") hex += '8';
        else if (chunk == "1001") hex += '9';
        else if (chunk == "1010") hex += 'a';
        else if (chunk == "1011") hex += 'b';
        else if (chunk == "1100") hex += 'c';
        else if (chunk == "1101") hex += 'd';
        else if (chunk == "1110") hex += 'e';
        else if (chunk == "1111") hex += 'f';
        else throw std::invalid_argument("Invalid binary chunk");
    }

    return hex;
}
