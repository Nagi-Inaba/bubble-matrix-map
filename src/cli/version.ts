declare const __BUBBLE_MATRIX_MAP_VERSION__: string

export const CLI_VERSION =
  typeof __BUBBLE_MATRIX_MAP_VERSION__ !== 'undefined'
    ? __BUBBLE_MATRIX_MAP_VERSION__
    : (process.env.npm_package_version ?? '0.0.0-dev')
