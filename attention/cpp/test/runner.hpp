// Minimal test harness. Tests are declared with TEST(name) { ... } in
// main.cpp; main() calls them in a fixed order, so a failure prints its
// name and the failure message. No C++ testing framework is used; keeping
// the binary self-contained is part of the "one clone, one build" rule.
#ifndef ATTENTION_CPP_TEST_RUNNER_HPP
#define ATTENTION_CPP_TEST_RUNNER_HPP

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

#endif
