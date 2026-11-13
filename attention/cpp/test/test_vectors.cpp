// Replays the golden vectors from attention/cpp/test/golden/*.txt against
// the C ABI. Missing golden files are skipped with a notice so a fresh
// checkout without a generator run still builds and passes; the JS-side
// parity test regenerates and checks the goldens independently.
#include "vectors.hpp"

#include <cstdint>
#include <cstdio>

extern "C" {
    std::int64_t att_scratch_ptr(void);
    std::int64_t att_scratch_size(void);
    std::int64_t att_levels_table(std::int64_t);
    std::int64_t att_validate(std::int64_t);
    std::int64_t att_step(std::int64_t);
}

#ifndef ATTENTION_GOLDEN_DIR
#error "ATTENTION_GOLDEN_DIR must be defined by CMake to the golden directory path"
#endif

namespace att_test {

void run_vectors(int* failures) {
    std::int64_t* scratch = reinterpret_cast<std::int64_t*>(att_scratch_ptr());
    std::int64_t cap = att_scratch_size();
    struct Entry { const char* file; const char* label; std::int64_t (*fn)(std::int64_t); };
    const Entry entries[] = {
        { ATTENTION_GOLDEN_DIR "/levels.txt",   "levels",   att_levels_table },
        { ATTENTION_GOLDEN_DIR "/validate.txt", "validate", att_validate     },
        { ATTENTION_GOLDEN_DIR "/step.txt",     "step",     att_step         },
    };
    for (const auto& e : entries) {
        replay_file(e.file, e.label, e.fn, scratch, cap, failures);
    }
}

} // namespace att_test
