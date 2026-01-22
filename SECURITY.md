# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in PrisML, please email **security@iamvini.co** instead of using the public issue tracker.

Please include:
- Description of the vulnerability
- Steps to reproduce (if applicable)
- Potential impact
- Your name and contact information (optional)

We will acknowledge receipt within 48 hours and provide a status update within 7 days. We ask that you do not publicly disclose the vulnerability until we have had a chance to issue a fix.

## Supported Versions

| Version | Supported | Security Updates |
|---------|-----------|------------------|
| 1.1.x   | Yes       | Latest stable    |
| 1.0.x   | Yes       | Until 1.2.0 release |
| <1.0    | No        | No updates |

## Known Security Limitations

### 1. Model Artifact Integrity

PrisML stores trained ONNX models as binary files in the repository. There is currently no cryptographic signing or verification. Users should:
- Store models in private repositories
- Review model changes in code review (they will appear as binary diffs)
- Consider additional integrity checks if deploying to production

### 2. Training Data Access

The `prisml train` command reads directly from your database using provided Prisma credentials. Ensure:
- Database credentials are never committed to version control
- Use `.env.local` and add to `.gitignore`
- Limit training data access to necessary fields only (via feature resolvers)
- Audit database access logs during training

### 3. ONNX Runtime Security

PrisML depends on onnxruntime-node, which uses native bindings. Security vulnerabilities in ONNX Runtime should be tracked at:
- [Microsoft/onnxruntime GitHub Issues](https://github.com/microsoft/onnxruntime/security)
- [National Vulnerability Database](https://nvd.nist.gov/)

Regularly update: `npm update onnxruntime-node`

### 4. Model Input Validation

PrisML does not validate model predictions are reasonable or safe for downstream use. Applications must:
- Validate prediction outputs before acting on them
- Implement safeguards for critical decisions (e.g., fraud detection should not automatically block users)
- Test model predictions in staging before production deployment
- Monitor predictions for unexpected patterns (model drift)

### 5. Not Suitable for Safety-Critical Applications

PrisML is designed for business logic (churn prediction, fraud scoring, recommendations). Do NOT use for:
- Medical diagnosis or treatment decisions
- Financial trading or loan approvals (without human review)
- Criminal justice or parole decisions
- Autonomous vehicle control

These require formal validation, regulatory approval, and additional safeguards beyond PrisML's scope.

## Security Best Practices

### For Users

1. **Keep Dependencies Updated**
   ```bash
   npm audit
   npm audit fix
   pnpm up
   ```

2. **Environment Variables**
   ```bash
   # .gitignore
   .env
   .env.local
   *.onnx  # optional: don't commit models
   ```

3. **Model Versioning**
   - Always version your models with git tags
   - Document which models are in production
   - Test model changes in staging

4. **Access Control**
   - Limit database query access during training
   - Use database roles with minimal permissions
   - Audit logs for sensitive data access

5. **Monitoring**
   - Track prediction accuracy over time (drift detection)
   - Alert on prediction anomalies
   - Log all predictions in high-stakes scenarios

### For Contributors

1. **Dependency Security**
   - Run `npm audit` before submitting PRs
   - Keep dependencies up-to-date
   - Use lock files (pnpm-lock.yaml)

2. **Code Review**
   - All security-sensitive changes require review
   - Use GitHub code owners for critical files

3. **Responsible Disclosure**
   - If you find a vulnerability while contributing, email security@iamvini.co
   - Do not open a public issue

## Security Scanning

PrisML does not currently integrate automated security scanning (SAST, DAST, dependency scanning). Consider adding:
- GitHub Dependabot for dependency updates
- npm audit in CI/CD
- Third-party SAST tools (e.g., Snyk, CodeQL) for code analysis

## Support

For security questions or concerns, contact: **security@iamvini.co**

For non-security bugs, use [GitHub Issues](https://github.com/vncsleal/prisml/issues).
