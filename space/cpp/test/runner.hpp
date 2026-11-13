// Minimal test harness. Tests are declared with TEST(name) { ... }. main()
// calls them in a fixed order (see main.cpp), so a failure prints its name
// and the failure message. No C++ testing framework is used; keeping the
// binary self-contained is part of the "one clone, one build" rule.
#ifndef SPACE_CPP_TEST_RUNNER_HPP
#define SPACE_CPP_TEST_RUNNER_HPP

#include <cstdio>

static int g_failures = 0;

#define EXPECT_TRUE(expr)                                                        \
    do {                                                                         \
        if (!(expr)) {                                                           \
            std::fprintf(stderr, "  FAIL %s:%d: %s\n", __FILE__, __LINE__, #expr); \
            ++g_failures;                                                        \
        }                                                                        \
    } while (0)

#define EXPECT_EQ_INT(a, b)                                                      \
    do {                                                                         \
        long long _a = (long long)(a);                                           \
        long long _b = (long long)(b);                                           \
        if (_a != _b) {                                                          \
            std::fprintf(stderr, "  FAIL %s:%d: %lld != %lld\n",                 \
                         __FILE__, __LINE__, _a, _b);                            \
            ++g_failures;                                                        \
        }                                                                        \
    } while (0)

namespace space_test {

struct TestCase { const char* name; void (*fn)(); };

// main.cpp declares an array of these and loops over them.
int run(const TestCase* cases, int n);

} // namespace space_test

#endif
