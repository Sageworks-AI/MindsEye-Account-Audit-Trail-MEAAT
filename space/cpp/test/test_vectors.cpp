// Replays the golden vectors from space/cpp/test/golden/*.txt against the
// C ABI. Missing golden files are skipped with a notice so a fresh checkout
// without a generator run still builds and passes; the parity test on the
// JS side is what actually enforces correctness of the vectors, and the
// build script populates the goldens on demand.
#include "vectors.hpp"

#include <cstdint>
#include <cstdio>

extern "C" {
    std::int64_t space_scratch_ptr(void);
    std::int64_t space_scratch_size(void);
    std::int64_t space_measure_text(std::int64_t);
    std::int64_t space_apportion(std::int64_t);
    std::int64_t space_claim_combine(std::int64_t);
    std::int64_t space_paginate(std::int64_t);
    std::int64_t space_anchor(std::int64_t);
    std::int64_t space_solve(std::int64_t);
}

#ifndef SPACE_GOLDEN_DIR
#error "SPACE_GOLDEN_DIR must be defined by CMake to the golden directory path"
#endif

namespace space_test {

void run_vectors(int* failures) {
    std::int64_t* scratch = reinterpret_cast<std::int64_t*>(space_scratch_ptr());
    std::int64_t cap = space_scratch_size();
    struct Entry { const char* file; const char* label; std::int64_t (*fn)(std::int64_t); };
    const Entry entries[] = {
        { SPACE_GOLDEN_DIR "/measure.txt",   "measure",   space_measure_text   },
        { SPACE_GOLDEN_DIR "/apportion.txt", "apportion", space_apportion      },
        { SPACE_GOLDEN_DIR "/claim.txt",     "claim",     space_claim_combine  },
        { SPACE_GOLDEN_DIR "/paginate.txt",  "paginate",  space_paginate       },
        { SPACE_GOLDEN_DIR "/anchor.txt",    "anchor",    space_anchor         },
        { SPACE_GOLDEN_DIR "/solve.txt",     "solve",     space_solve          },
    };
    for (const auto& e : entries) {
        replay_file(e.file, e.label, e.fn, scratch, cap, failures);
    }
}

} // namespace space_test
