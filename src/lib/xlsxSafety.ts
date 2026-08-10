import { inflateRawSync } from 'node:zlib'

const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 20_000

function formatFixedInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export class UnsafeXlsxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeXlsxError'
  }
}

export type XlsxSafetyErrorLike = { message: string }

function isXlsxSafetyError(error: unknown): error is XlsxSafetyErrorLike {
  return typeof error === 'object' && error !== null && 'name' in (error as Record<string, unknown>) && (error as Record<string, unknown>).name === 'UnsafeXlsxError'
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 65_557)
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  }
  throw new UnsafeXlsxError('ExcelファイルのZIP終端レコードが見つかりません。')
}

function unsafeXlsx(message: string): never {
  throw new UnsafeXlsxError(message)
}

export function validateXlsxSafety(buffer: ArrayBuffer): void {
  const view = new DataView(buffer)
  if (view.byteLength < 22) unsafeXlsx('Excelファイルが短すぎます。')
  const endOffset = findEndOfCentralDirectory(view)
  const diskNumber = view.getUint16(endOffset + 4, true)
  const centralDisk = view.getUint16(endOffset + 6, true)
  const entriesOnDisk = view.getUint16(endOffset + 8, true)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralSize = view.getUint32(endOffset + 12, true)
  const centralOffset = view.getUint32(endOffset + 16, true)
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    unsafeXlsx('複数ディスク形式のExcelファイルは読み込めません。')
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    unsafeXlsx('ZIP64形式のExcelファイルは読み込めません。')
  }
  if (entryCount > MAX_ENTRIES) unsafeXlsx(`Excelファイル内のエントリ数が上限（${formatFixedInteger(MAX_ENTRIES)}件）を超えています。`)

  const centralEnd = centralOffset + centralSize
  if (centralOffset > endOffset || centralEnd !== endOffset) {
    unsafeXlsx('ExcelファイルのZIPディレクトリ範囲が一致しません。')
  }

  const bytes = Buffer.from(buffer)
  let centralEntryOffset = centralOffset
  let actualTotalBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (centralEntryOffset + 46 > centralEnd || view.getUint32(centralEntryOffset, true) !== 0x02014b50) {
      unsafeXlsx('ExcelファイルのZIPエントリが壊れています。')
    }
    const flags = view.getUint16(centralEntryOffset + 8, true)
    const compressionMethod = view.getUint16(centralEntryOffset + 10, true)
    const compressedBytes = view.getUint32(centralEntryOffset + 20, true)
    const declaredBytes = view.getUint32(centralEntryOffset + 24, true)
    const fileNameLength = view.getUint16(centralEntryOffset + 28, true)
    const extraLength = view.getUint16(centralEntryOffset + 30, true)
    const commentLength = view.getUint16(centralEntryOffset + 32, true)
    const localHeaderOffset = view.getUint32(centralEntryOffset + 42, true)
    if ((flags & 0x1) !== 0) unsafeXlsx('暗号化されたExcelファイルは読み込めません。')
    if (compressedBytes === 0xffffffff || declaredBytes === 0xffffffff || localHeaderOffset === 0xffffffff) {
      unsafeXlsx('ZIP64形式のExcelエントリは読み込めません。')
    }
    if (declaredBytes > MAX_ENTRY_BYTES) unsafeXlsx(`Excelファイル内の1エントリが展開上限（${MAX_ENTRY_BYTES / 1024 / 1024}MB）を超えています。`)
    if (localHeaderOffset + 30 > centralOffset || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      unsafeXlsx('ExcelファイルのローカルZIPヘッダーが壊れています。')
    }

    const localMethod = view.getUint16(localHeaderOffset + 8, true)
    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    if (localMethod !== compressionMethod) {
      unsafeXlsx('Excelファイルの圧縮方式がヘッダー間で一致しません。')
    }

    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const dataEnd = dataOffset + compressedBytes
    if (dataOffset > centralOffset || dataEnd > centralOffset || dataEnd > bytes.length) {
      unsafeXlsx('Excelファイルの圧縮データ範囲が壊れています。')
    }

    let actualBytes: number
    if (compressionMethod === 0) {
      actualBytes = compressedBytes
    } else if (compressionMethod === 8) {
      try {
        actualBytes = inflateRawSync(bytes.subarray(dataOffset, dataEnd), { maxOutputLength: MAX_ENTRY_BYTES + 1 }).byteLength
      } catch (error: unknown) {
        if (isXlsxSafetyError(error)) throw error
        const message = error instanceof Error ? error.message : String(error)
        unsafeXlsx(`Excelファイルの展開検査に失敗しました: ${message}`)
      }
    } else {
      unsafeXlsx(`未対応のZIP圧縮方式です: ${compressionMethod}`)
    }
    if (actualBytes !== declaredBytes) unsafeXlsx('Excelファイルの実際の展開サイズがZIPヘッダーの申告値と一致しません。')
    actualTotalBytes += actualBytes
    if (actualTotalBytes > MAX_TOTAL_BYTES) {
      unsafeXlsx(`Excelファイル全体が展開上限（${MAX_TOTAL_BYTES / 1024 / 1024}MB）を超えています。`)
    }
    centralEntryOffset += 46 + fileNameLength + extraLength + commentLength
  }
  if (centralEntryOffset !== centralEnd) {
    unsafeXlsx('ExcelファイルのZIPエントリ件数とディレクトリ長が一致しません。')
  }
}
