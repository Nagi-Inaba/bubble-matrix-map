export type DataRow = Record<string, string>

export type ColumnKind = 'year' | 'numeric' | 'text'

export type ColumnProfile = {
  name: string
  kind: ColumnKind
  nonEmpty: number
  blankCount: number
  uniqueCount: number
  samples: string[]
}

export type NoticeDetails = {
  count?: number
  bytes?: number
  format?: 'CSV' | 'TSV' | 'Excel'
  encoding?: string
  delimiter?: string
}

export const NOTICE_CODES = [
  'AXIS_BLANK_ROWS_EXCLUDED',
  'AXIS_OTHER_GROUPED',
  'AXIS_TOP_N_ROWS_EXCLUDED',
  'BLANK_HEADERS_FILLED',
  'DUPLICATE_HEADERS_RENAMED',
  'LARGE_INPUT_FILE',
  'LONG_ROWS_TRUNCATED',
  'MULTI_VALUE_FULL_COUNT',
  'NO_ROWS_IN_PERIOD',
  'PIE_TOP_N_ROWS_EXCLUDED',
  'SHORT_ROWS_PADDED',
  'SOURCE_FORMAT_DETECTED',
  'YEAR_MISSING_ROWS_EXCLUDED',
] as const

export type NoticeCode = (typeof NOTICE_CODES)[number]

export type StructuredNotice = {
  code: NoticeCode
  message: string
  severity: 'info' | 'warning'
  field?: string
  details?: NoticeDetails
}

export type DatasetFile = {
  fileName: string
  columns: string[]
  rows: DataRow[]
  diagnostics?: StructuredNotice[]
  sourceInfo?: {
    format: 'CSV' | 'TSV' | 'Excel'
    encoding?: string
    delimiter?: string
    worksheetName?: string
  }
}

export type PieSourceMode = 'column' | 'year_bucket'
export type ColumnSliceStrategy = 'top_n_with_other' | 'top_n_only'
export type YearBucketMode = 'four_periods' | 'recent_vs_other'
export type ClassificationLevel = 'full' | 'class' | 'subclass' | 'main_group' | 'subgroup'
export type ClassificationSplitMode = 'all' | 'first'

export type MatrixSettings = {
  xAxis: string
  yAxis: string
  yearColumn: string
  xLimit: number
  yLimit: number
  pieSourceMode: PieSourceMode
  pieColumn: string
  columnSliceStrategy: ColumnSliceStrategy
  pieTopN: number
  periodStart: string
  periodEnd: string
  yearBucketMode: YearBucketMode
  periodBoundaries: string
  recentYears: number
  includeAxisOther: boolean
  showCounts: boolean
  classificationSplitMode: ClassificationSplitMode
  xClassificationLevel: ClassificationLevel
  yClassificationLevel: ClassificationLevel
  pieClassificationLevel: ClassificationLevel
}

export type MatrixSettingsV1 = Omit<
  MatrixSettings,
  'xLimit' | 'yLimit' | 'pieTopN' | 'recentYears' | 'showCounts'
> & {
  xLimit: string
  yLimit: string
  pieTopN: string
  recentYears: string
}

export type LegendItem = {
  label: string
  color: string
}

export type MatrixSlice = {
  label: string
  value: number
  share: number
  color: string
}

export type MatrixCell = {
  xLabel: string
  yLabel: string
  total: number
  rowCount: number
  slices: MatrixSlice[]
}

export type MatrixResult = {
  xCategories: string[]
  yCategories: string[]
  cells: MatrixCell[]
  topCells: MatrixCell[]
  legend: LegendItem[]
  totalRows: number
  scopedRows: number
  includedRows: number
  pieExcludedRows: number
  axisBlankRows: number
  axisOtherRows: number
  axisExcludedRows: number
  maxTotal: number
  summary: string
  warnings: StructuredNotice[]
}
