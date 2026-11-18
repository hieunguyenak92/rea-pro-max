#include <stdint.h>

uint16_t quote(uint8_t units) {
    if (units < 80u) {
        return (uint16_t)(3u * units + 7u);
    }
    if (units < 176u) {
        return (uint16_t)(247u + (units - 80u) * 2u);
    }
    return (uint16_t)(439u + units - 176u);
}
