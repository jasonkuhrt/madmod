import pc from 'picocolors'

export const symbols = {
  pass: pc.green('\u2713'),
  fail: pc.red('\u2717'),
  warn: pc.yellow('\u26A0'),
  info: pc.blue('\u2139'),
  arrow: pc.dim('\u2192'),
  suggest: pc.cyan('\u26A1'),
  create: pc.green('CREATE'),
  update: pc.yellow('UPDATE'),
  skip: pc.dim('SKIP'),
  conflict: pc.red('CONFLICT'),
} as const
