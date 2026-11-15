export interface AccountFormFields { name: string; email: string; password: string; confirmation: string; code: string }

/** Password managers may fill controls without firing React change events. */
export function readAccountForm(form: Pick<FormData, 'get'>, fallback: AccountFormFields): AccountFormFields {
  const field = (name: string, previous: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value : previous
  }
  return {
    name: field('nickname', fallback.name), email: field('username', fallback.email),
    password: field('newPassword', field('password', fallback.password)),
    confirmation: field('confirmPassword', fallback.confirmation), code: field('code', fallback.code),
  }
}
