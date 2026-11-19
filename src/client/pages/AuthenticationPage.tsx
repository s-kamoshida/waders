/**
 * ログインの画面と、アカウントの作成の画面（issue #11）。
 *
 * 所属: クライアント
 * 責務:
 *  - アカウントの作成: ID・パスワード・確認のパスワードを入力し、形式と一致を確かめてから送る。作ったらログインした状態になる
 *  - ログイン: ID とパスワードを送る。失敗した理由はサーバーの文言をそのまま表示する（どちらが誤りかは示さない）
 * 入力の形式は src/shared/authenticationContract.ts のスキーマで検証する。
 */
import { useId, useState, type FormEvent } from 'react';
import { accountSetupRequestSchema } from '../../shared/authenticationContract.ts';
import { collectFieldErrors } from '../../shared/productContract.ts';
import { ApiRequestError, logIn, setUpAccount } from '../productApiClient.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** 画面の種類。setup はアカウントの作成、login はログイン。 */
export type AuthenticationMode = 'setup' | 'login';

/** AuthenticationPage の引数。 */
export type AuthenticationPageProps = {
  readonly mode: AuthenticationMode;
  /** アカウントを作った、またはログインしたときに呼ぶ。 */
  readonly onAuthenticated: () => void;
};

/** 入力欄の誤り（項目名 → 文言）。 */
type FieldErrors = Readonly<Record<string, string>>;

/** API の失敗を、画面全体の文言と項目ごとの文言にする。 */
function describeRequestError(error: unknown): { formError: string; fieldErrors: FieldErrors } {
  if (!(error instanceof ApiRequestError) || error.code === 'UNKNOWN_ERROR') {
    return { formError: SCREEN_MESSAGES.authenticationFailed, fieldErrors: {} };
  }
  return { formError: error.message, fieldErrors: error.fieldErrors };
}

/** ログインの画面、またはアカウントの作成の画面を表示する。 */
export function AuthenticationPage({ mode, onAuthenticated }: AuthenticationPageProps) {
  const idPrefix = useId();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSetup = mode === 'setup';
  const title = isSetup ? SCREEN_MESSAGES.accountSetupTitle : SCREEN_MESSAGES.loginTitle;

  /** 送る前に入力を確かめる。誤りがあれば表示して false を返す。 */
  const validateBeforeSubmit = (): boolean => {
    if (!isSetup) {
      const isFilled = loginId.trim() !== '' && password !== '';
      setFieldErrors({});
      setFormError(isFilled ? undefined : SCREEN_MESSAGES.loginFieldsRequired);
      return isFilled;
    }
    const parsed = accountSetupRequestSchema.safeParse({ loginId, password });
    const errors: Record<string, string> = parsed.success ? {} : collectFieldErrors(parsed.error);
    if (errors.password === undefined && password !== passwordConfirmation) errors.passwordConfirmation = SCREEN_MESSAGES.passwordMismatch;
    setFieldErrors(errors);
    setFormError(undefined);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !validateBeforeSubmit()) return;
    setIsSubmitting(true);
    try {
      if (isSetup) await setUpAccount(loginId.trim(), password);
      else await logIn(loginId, password);
      onAuthenticated();
    } catch (error) {
      const described = describeRequestError(error);
      setFormError(described.formError);
      setFieldErrors(described.fieldErrors);
      setIsSubmitting(false);
    }
  };

  /** 入力欄の id。 */
  const fieldId = (fieldName: string) => `${idPrefix}-${fieldName}`;

  /** 入力欄の下に表示する誤り。 */
  const renderFieldError = (fieldName: string) =>
    fieldErrors[fieldName] === undefined ? null : (
      <span id={`${fieldId(fieldName)}-error`} className="field-error">
        {fieldErrors[fieldName]}
      </span>
    );

  /** 入力欄の誤りに関わる属性。 */
  const errorAttributes = (fieldName: string) =>
    fieldErrors[fieldName] === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${fieldId(fieldName)}-error` };

  return (
    <section className="authentication" aria-labelledby={`${idPrefix}-title`}>
      <form className="authentication-form" noValidate onSubmit={(event) => void submit(event)}>
        <h2 id={`${idPrefix}-title`} className="authentication-title">
          {title}
        </h2>
        {isSetup && <p className="hint">{SCREEN_MESSAGES.accountSetupNote}</p>}
        {formError !== undefined && (
          <p role="alert" className="dialog-error">
            {formError}
          </p>
        )}
        <div className="field">
          <label htmlFor={fieldId('loginId')}>ID</label>
          <input
            id={fieldId('loginId')}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
            {...errorAttributes('loginId')}
          />
          {renderFieldError('loginId')}
        </div>
        <div className="field">
          <label htmlFor={fieldId('password')}>パスワード</label>
          <input
            id={fieldId('password')}
            type="password"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            {...errorAttributes('password')}
          />
          {renderFieldError('password')}
        </div>
        {isSetup && (
          <div className="field">
            <label htmlFor={fieldId('passwordConfirmation')}>パスワード（確認）</label>
            <input
              id={fieldId('passwordConfirmation')}
              type="password"
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              {...errorAttributes('passwordConfirmation')}
            />
            {renderFieldError('passwordConfirmation')}
          </div>
        )}
        <button type="submit" className="button button--primary authentication-submit" disabled={isSubmitting}>
          {isSetup ? 'アカウントを作成' : 'ログイン'}
        </button>
      </form>
    </section>
  );
}
