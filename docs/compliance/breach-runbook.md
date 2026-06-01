# Personal data breach runbook

What to do when personal data may have been exposed, lost, or accessed without
authorisation. Speed matters — several regimes have hard notification windows.

## Notification clocks (know these cold)

| Regime | Authority deadline | Notify individuals |
|---|---|---|
| GDPR / UK GDPR | 72 hours from awareness | Without undue delay, if high risk |
| Australia (NDB scheme) | "As soon as practicable" | If likely serious harm |
| India (DPDP) | As prescribed (without delay) | Affected Data Principals |
| Singapore / others (PDPA) | Per local rule (often ~3 days) | Where threshold met |

When in doubt, treat the **72-hour GDPR clock** as the binding one.

## Steps

1. **Triage & contain (hour 0–2).** Identify what data, how many subjects,
   which orgs. Revoke leaked credentials/keys. Stop ongoing exposure. Do not
   destroy evidence.
2. **Assemble.** Notify the privacy owner (privacy@elanguagecenter.com) and
   engineering lead. Open an incident doc; record a timeline as you go.
3. **Assess risk.** Categories (is voice/sensitive data involved?), volume,
   likelihood of harm, whether data was encrypted/pseudonymised.
4. **Scope by tenant.** Use `org_id` to determine which Organizations are
   affected. For `CustomerControlled` orgs **we are the processor** — notify
   the controller org "without undue delay" with the facts they need; they
   notify their authority/learners. For `PlatformControlled` (self-serve) **we
   are the controller** and notify directly.
5. **Notify authorities** within the applicable window above. Include nature of
   breach, categories/approx. numbers, likely consequences, measures taken.
6. **Notify individuals** where the harm threshold is met, in plain language,
   with steps they can take.
7. **Remediate & document.** Fix root cause, record everything (the GDPR
   requires a record of all breaches even if not notifiable), run a
   post-incident review, update controls.

## Useful queries / levers

- Affected users by org: filter `User` / `Attempt` / `Recording` by `org_id`.
- Consent + rights history for a subject: `ConsentRecord` + `DataRightsRequest`.
- Kill recording exposure: recordings are private R2 objects served only via
  15-minute signed URLs; rotate R2 credentials to invalidate any leaked signer.

## Contacts

- Privacy owner: privacy@elanguagecenter.com
- (Add: DPO / local representatives per jurisdiction, authority portals, legal
  counsel — to be completed with counsel.)
