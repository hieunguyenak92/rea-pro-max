#include <stdint.h>
#include <stdio.h>

uint16_t quote(uint8_t units);

int main(void) {
#if defined(__aarch64__) || defined(__arm64__)
    puts("arm64");
#elif defined(__x86_64__) || defined(_M_X64)
    puts("x86_64");
#else
    puts("unsupported");
#endif
    for (unsigned input = 0; input <= UINT8_MAX; ++input) {
        printf("%u %u\n", input, (unsigned)quote((uint8_t)input));
    }
    return 0;
}
