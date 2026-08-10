import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { UnsafeXlsxError, validateXlsxSafety } from './xlsxSafety'

describe('validateXlsxSafety', () => {
  it('rethrows malformed workbook inflation data as unsafe-xlsx errors', () => {
    expect(() => validateXlsxSafety(forgedArchive())).toThrow(UnsafeXlsxError)
    expect(() => validateXlsxSafety(forgedArchive())).toThrow('実際の展開サイズ')
  })

  it('rejects central-directory mismatches by entry count and structure', () => {
    expect(() => validateXlsxSafety(forgedEntryCountArchive())).toThrow('エントリ件数とディレクトリ長')
  })
})

function forgedArchive(): ArrayBuffer {
  const expanded = Buffer.alloc(1024 * 1024)
  const compressed = deflateRawSync(expanded)
  const localSize = 30 + 1 + compressed.length
  const centralSize = 46 + 1
  const bytes = Buffer.alloc(localSize + centralSize + 22)
  bytes.writeUInt32LE(0x04034b50, 0)
  bytes.writeUInt16LE(8, 8)
  bytes.writeUInt32LE(compressed.length, 18)
  bytes.writeUInt32LE(1, 22)
  bytes.writeUInt16LE(1, 26)
  bytes.write('x', 30)
  compressed.copy(bytes, 31)
  const central = localSize
  bytes.writeUInt32LE(0x02014b50, central)
  bytes.writeUInt16LE(8, central + 10)
  bytes.writeUInt32LE(compressed.length, central + 20)
  bytes.writeUInt32LE(1, central + 24)
  bytes.writeUInt16LE(1, central + 28)
  bytes.writeUInt32LE(0, central + 42)
  bytes.write('x', central + 46)
  const end = localSize + centralSize
  bytes.writeUInt32LE(0x06054b50, end)
  bytes.writeUInt16LE(1, end + 8)
  bytes.writeUInt16LE(1, end + 10)
  bytes.writeUInt32LE(centralSize, end + 12)
  bytes.writeUInt32LE(central, end + 16)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function forgedEntryCountArchive(): ArrayBuffer {
  const localSize = 31
  const centralEntrySize = 47
  const centralSize = centralEntrySize * 2
  const bytes = Buffer.alloc(localSize + centralSize + 22)
  bytes.writeUInt32LE(0x04034b50, 0)
  bytes.writeUInt16LE(1, 26)
  bytes.write('x', 30)
  for (let index = 0; index < 2; index += 1) {
    const central = localSize + index * centralEntrySize
    bytes.writeUInt32LE(0x02014b50, central)
    bytes.writeUInt16LE(1, central + 28)
    bytes.writeUInt32LE(0, central + 42)
    bytes.write(index === 0 ? 'x' : 'y', central + 46)
  }
  const end = localSize + centralSize
  bytes.writeUInt32LE(0x06054b50, end)
  bytes.writeUInt16LE(1, end + 8)
  bytes.writeUInt16LE(1, end + 10)
  bytes.writeUInt32LE(centralSize, end + 12)
  bytes.writeUInt32LE(localSize, end + 16)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
