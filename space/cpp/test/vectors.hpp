// Helpers shared by test_vectors.cpp: hex encoding of int64, file reading,
// per-function golden replay. Errors are reported through fprintf; the test
// driver adds up g_failures.
#ifndef SPACE_CPP_TEST_VECTORS_HPP
#define SPACE_CPP_TEST_VECTORS_HPP

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

namespace space_test {

inline bool hex_to_u64(const char* h, std::uint64_t* out) {
    std::uint64_t v = 0;
    for (int i = 0; i < 16; ++i) {
        char c = h[i];
        int d;
        if (c >= '0' && c <= '9') d = c - '0';
        else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
        else return false;
        v = (v << 4) | (std::uint64_t)d;
    }
    *out = v;
    return true;
}

inline void u64_to_hex(std::uint64_t v, char* out) {
    static const char hex[] = "0123456789abcdef";
    for (int i = 15; i >= 0; --i) {
        out[i] = hex[v & 0xF];
        v >>= 4;
    }
}

// Decodes a hex string (length multiple of 16) into int64 values.
inline bool decode_int64_array(const std::string& hex, std::vector<std::int64_t>* out) {
    if (hex.size() % 16 != 0) return false;
    out->resize(hex.size() / 16);
    for (std::size_t i = 0; i < out->size(); ++i) {
        std::uint64_t u;
        if (!hex_to_u64(hex.c_str() + i * 16, &u)) return false;
        (*out)[i] = (std::int64_t)u;
    }
    return true;
}

inline std::string encode_int64_array(const std::int64_t* v, std::size_t n) {
    std::string s;
    s.resize(n * 16);
    for (std::size_t i = 0; i < n; ++i) u64_to_hex((std::uint64_t)v[i], &s[i * 16]);
    return s;
}

// A single golden file: one "in:<hex> out:<hex>" per line, '#' for comments,
// blank lines skipped. Replay is delegated to a caller function that
// consumes `in` and returns the produced values.
inline int replay_file(const char* path, const char* label,
                       std::int64_t (*fn)(std::int64_t),
                       std::int64_t* scratch, std::int64_t scratchCap,
                       int* failures) {
    std::ifstream f(path);
    if (!f) {
        std::fprintf(stderr, "  skip: %s (missing: %s)\n", label, path);
        return 0;
    }
    std::string line;
    int lineNo = 0;
    int count = 0;
    while (std::getline(f, line)) {
        ++lineNo;
        if (line.empty() || line[0] == '#') continue;
        auto inPos = line.find("in:");
        auto outPos = line.find(" out:");
        if (inPos == std::string::npos || outPos == std::string::npos) {
            std::fprintf(stderr, "  FAIL %s line %d: malformed\n", path, lineNo);
            ++*failures;
            continue;
        }
        std::string inHex = line.substr(inPos + 3, outPos - (inPos + 3));
        std::string outHex = line.substr(outPos + 5);
        std::vector<std::int64_t> inVals, expected;
        if (!decode_int64_array(inHex, &inVals) || !decode_int64_array(outHex, &expected)) {
            std::fprintf(stderr, "  FAIL %s line %d: bad hex\n", path, lineNo);
            ++*failures;
            continue;
        }
        if ((std::int64_t)inVals.size() > scratchCap / 2) {
            std::fprintf(stderr, "  FAIL %s line %d: input too large\n", path, lineNo);
            ++*failures;
            continue;
        }
        for (std::size_t i = 0; i < inVals.size(); ++i) scratch[i] = inVals[i];
        std::int64_t outLen = fn((std::int64_t)inVals.size());
        if (outLen < 0) {
            std::fprintf(stderr, "  FAIL %s line %d: %s -> %lld\n",
                         path, lineNo, label, (long long)outLen);
            ++*failures;
            continue;
        }
        std::int64_t* outVals = scratch + inVals.size();
        if ((std::size_t)outLen != expected.size()) {
            std::fprintf(stderr, "  FAIL %s line %d: outLen %lld != %zu\n",
                         path, lineNo, (long long)outLen, expected.size());
            ++*failures;
            continue;
        }
        for (std::size_t i = 0; i < expected.size(); ++i) {
            if (outVals[i] != expected[i]) {
                std::fprintf(stderr, "  FAIL %s line %d: out[%zu] %lld != %lld\n",
                             path, lineNo, i, (long long)outVals[i], (long long)expected[i]);
                ++*failures;
                break;
            }
        }
        ++count;
    }
    std::printf("  %s: replayed %d\n", label, count);
    return count;
}

} // namespace space_test

#endif
