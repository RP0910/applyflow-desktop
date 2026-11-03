/** Login saved for an employer ATS / career portal (Workday, Greenhouse account, etc.). */
export interface SiteCredential {
  /** Hostname key, e.g. "contoso.wd5.myworkdayjobs.com". */
  host: string;
  /** Origin or portal URL used when the credential was saved. */
  url: string;
  email: string;
  password: string;
  updatedAt: string;
}

/** Default password used when ApplyFlow first stores a job-site login. */
export const DEFAULT_SITE_PASSWORD = 'QWE@#$qwe234';
