"""Minimal PNG reader for screenshot QA (RGBA/RGB, 8-bit, no interlace).

Used to sample exact pixel colours from `adb screencap` output so visual claims
(the HUD cut, contrast, pattern z-order) can be verified numerically instead of
by eye.
"""
import struct
import sys
import zlib


def read_png(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos = 8
    header = None
    idat = bytearray()
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b'IHDR':
            header = struct.unpack('>IIBBBBB', chunk)
        elif ctype == b'IDAT':
            idat += chunk
        elif ctype == b'IEND':
            break
    width, height, depth, color, comp, filt, interlace = header
    assert depth == 8 and interlace == 0 and comp == 0 and filt == 0, header
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        ftype = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = prev[i]
                upleft = prev[i - channels] if i >= channels else 0
                p = left + up - upleft
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - upleft)
                pred = left if (pa <= pb and pa <= pc) else (up if pb <= pc else upleft)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, out


def pixel(img, x, y):
    width, height, channels, buf = img
    off = (y * width + x) * channels
    return tuple(buf[off:off + 3])


def hexcol(rgb):
    return '#%02X%02X%02X' % rgb


if __name__ == '__main__':
    path = sys.argv[1]
    img = read_png(path)
    print('size', img[0], img[1], 'channels', img[2])
    for spec in sys.argv[2:]:
        x, y = (int(v) for v in spec.split(','))
        print('  (%d,%d) -> %s' % (x, y, hexcol(pixel(img, x, y))))
