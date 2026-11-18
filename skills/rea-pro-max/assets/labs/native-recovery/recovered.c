#include <stdint.h>

uint16_t quote(uint8_t units) {
    /* The recovered offsets express each segment on the original input axis. */
    if (units >= 176u) {
        return (uint16_t)(units + 263u);
    }
    if (units >= 80u) {
        return (uint16_t)(87u + (uint16_t)units * 2u);
    }
    return (uint16_t)(7u + (uint16_t)units * 3u);
}
