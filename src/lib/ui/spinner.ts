import yoctoSpinner from 'yocto-spinner'

export const createSpinner = (text: string) => {
  const spinner = yoctoSpinner({ text })
  return {
    start: () => spinner.start(),
    success: (text?: string) => spinner.success(text),
    error: (text?: string) => spinner.error(text),
    stop: () => spinner.stop(),
  }
}
