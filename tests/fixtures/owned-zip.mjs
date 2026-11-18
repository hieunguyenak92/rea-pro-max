import { deflateRawSync } from 'node:zlib';

function checksum(bytes) {
  let value = -1;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (~value) >>> 0;
}

export function ownedZip(entries, comment = Buffer.alloc(0)) {
  let offset = 0;
  const localFiles = [];
  const records = [];
  for (const entry of entries) {
    const { name, raw = Buffer.alloc(0), method = 0, descriptor, extraFlags = 0, unixMode, storedData, claimedSize, claimedCrc } = entry;
    const nameBytes = Buffer.from(name);
    const flags = 0x800 | extraFlags | (descriptor ? 0x08 : 0);
    const data = storedData ?? (method === 8 ? deflateRawSync(raw) : raw);
    const crc = claimedCrc ?? checksum(raw);
    const size = claimedSize ?? raw.length;
    const local = Buffer.alloc(30 + nameBytes.length);
    const central = Buffer.alloc(46 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    let footer = Buffer.alloc(0);
    if (descriptor) {
      const prefix = descriptor === 'signed' ? 4 : 0;
      footer = Buffer.alloc(12 + prefix);
      if (prefix) footer.writeUInt32LE(0x08074b50, 0);
      footer.writeUInt32LE(crc, prefix);
      footer.writeUInt32LE(data.length, prefix + 4);
      footer.writeUInt32LE(size, prefix + 8);
    } else {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(size, 22);
    }
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    if (unixMode !== undefined) {
      central[5] = 3;
      central.writeUInt16LE(unixMode, 40);
    }
    central.writeUInt32LE(entry.offset ?? offset, 42);
    nameBytes.copy(central, 46);
    localFiles.push(local, data, footer);
    records.push(central);
    offset += local.length + data.length + footer.length;
  }
  const directory = Buffer.concat(records);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...localFiles, directory, end, comment]);
}
