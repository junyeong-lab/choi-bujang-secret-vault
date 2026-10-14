/**
 * XDR-03: CVE-2021-44228 / MITRE ATT&CK T1190
 * Deterministic, self-contained classifier for educational Wazuh alerts.
 * No file access, network requests, imported modules or side effects.
 * Pattern names and evidence match xdr/known-cve/patterns.json.
 */
const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'JNDI 원격 조회 구문',
    condition: '요청 URL 인자나 User-Agent에 완결된 JNDI 원격 조회 표현식',
    evidence: 'CVE-2021-44228 및 MITRE ATT&CK T1190',
  }),
  Object.freeze({
    name: 'CVE-2021-44228 탐지·점검 징후',
    condition: 'T1190 경보에서 CVE 또는 Log4Shell 명칭만 관측',
    evidence: 'CVE-2021-44228 및 MITRE ATT&CK T1190',
  }),
  Object.freeze({
    name: '불완전 JNDI·조회 구문 단서',
    condition: 'T1190 경보에서 JNDI 단어 또는 불완전 조회 흔적',
    evidence: 'CVE-2021-44228 및 MITRE ATT&CK T1190',
  }),
  Object.freeze({
    name: '취약점 스캐너·라이브러리 점검 단서',
    condition: 'T1190 경보에서 진단 도구나 라이브러리 확인 흔적',
    evidence: 'MITRE ATT&CK T1190',
  }),
]);
const DIRECT_JNDI = /\$\{jndi:(?:ldap|ldaps|rmi|dns|iiop|corba|nis):\/\/[^}\s]{1,512}\}/iu;
const CVE_CONTEXT = /CVE[- ]2021[- ]44228|log4shell/iu;
const JNDI_FRAGMENT = /jndi|조회\s*(?:구문|형태)|중괄호|lookup[-_ ]?fragment|원격\s*조회/iu;
const TOOL_CONTEXT = /취약점|점검|스캐너|라이브러리|class[-_ ]?(?:check|browser)|cve[-_ ]?list|log[-_ ]?library/iu;

export function decide(alert) {
  const data = alert && typeof alert === 'object' ? alert.data : null;
  const rule = alert && typeof alert === 'object' ? alert.rule : null;
  const source = typeof data?.srcip === 'string' ? data.srcip.trim() : '';
  const level = rule?.level;
  const validLevel = typeof level === 'number' && Number.isFinite(level);
  const url = typeof data?.url === 'string' ? data.url.slice(0, 4096) : '';
  const agent = typeof data?.useragent === 'string' ? data.useragent.slice(0, 4096) : '';
  const description = typeof rule?.description === 'string'
    ? rule.description.slice(0, 4096) : '';
  const tagged = Array.isArray(rule?.mitre) && rule.mitre.includes('T1190');

  // Only unmistakable request-side material can trigger blocking.
  if (source && validLevel && level >= 10 && (DIRECT_JNDI.test(url) || DIRECT_JNDI.test(agent))) {
    return {
      action: 'block',
      confidence: tagged ? 0.98 : 0.87,
      reason: PATTERNS[0].name,
    };
  }

  // A CVE reference or incomplete marker is a review signal, not a ban.
  if (source && validLevel && level >= 5 && tagged) {
    const evidence = description + '\n' + url + '\n' + agent;
    let pattern = null;
    if (CVE_CONTEXT.test(evidence)) pattern = PATTERNS[1];
    else if (JNDI_FRAGMENT.test(evidence)) pattern = PATTERNS[2];
    else if (TOOL_CONTEXT.test(evidence)) pattern = PATTERNS[3];
    if (pattern) {
      return { action: 'alert', confidence: 0.62, reason: pattern.name };
    }
  }

  return {
    action: 'record',
    confidence: 0.05,
    reason: 'CVE-2021-44228 악용 근거 부족',
  };
}
