export function shouldBootstrapMainRenderer(hash: string): boolean {
  return !/^#\/?toolbar(?:[/?]|$)/.test(hash)
}
