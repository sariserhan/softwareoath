import {
  ArrowRight, Boxes, Check, CircleSlash2, Clock3, CodeXml,
  FileCheck2, Fingerprint, FolderGit2, GitBranch, LockKeyhole,
  PackageSearch, Radar, ShieldCheck, UserRoundCheck,
} from "lucide-react";
import { SoftwareOathLogo } from "./SoftwareOathLogo.js";
import "../marketing.css";

const products = [
  { icon: FolderGit2, title: "Repository Steward", copy: "Understands your code, rules, dependencies, and operational context—then keeps that knowledge current." },
  { icon: PackageSearch, title: "Dependency Optimizer", copy: "Finds active services, compares compatibility and cost, and prepares owner-authorized migration plans." },
  { icon: Clock3, title: "Incident Replay", copy: "Reconstructs historical failures and tests repairs against the evidence that originally exposed them." },
  { icon: Fingerprint, title: "Cryptographic Evidence", copy: "Signs repair receipts, owner decisions, cost artifacts, and attestations for independent verification." },
];

const steps = [
  [LockKeyhole, "Connect", "Authorize one repository with least-privilege GitHub access."],
  [Radar, "Understand", "Build durable knowledge of code, promises, and dependencies."],
  [GitBranch, "Prepare", "Create one minimal repair inside an isolated workspace."],
  [ShieldCheck, "Prove", "Run repository checks and bind the evidence to the change."],
  [UserRoundCheck, "Review", "Inspect the patch and evidence. You make the decision."],
] as const;

const safety = [
  [Boxes, "Isolated execution", "Analysis and changes run in ephemeral, network-restricted environments."],
  [Radar, "Exact scope", "Every repair is constrained to declared paths and protected boundaries."],
  [GitBranch, "Immutable commits", "Every run remains bound to the exact commit it analyzed."],
  [FileCheck2, "Signed evidence", "Receipts and final decisions are signed, timestamped, and verifiable."],
  [CircleSlash2, "Never auto-merge", "Software Oath never approves or merges its own pull request."],
] as const;

function EvidencePreview() {
  return (
    <div className="marketing-proof" aria-label="Example Software Oath repair evidence">
      <div className="proof-steps">
        {['Understand', 'Repair', 'Verify', 'Owner review'].map((label, index) => (
          <span className={index === 0 ? "active" : ""} key={label}><b>{index + 1}</b>{label}</span>
        ))}
      </div>
      <div className="proof-body">
        <div className="proof-tree">
          <small>EXACT SCOPE</small>
          <p>acme/payment-service</p><p>└─ src</p><p>   ├─ package.json</p>
          <p className="lime">   └─ charge.ts</p><p className="muted">.github/workflows/ci.yml</p>
        </div>
        <div className="proof-code">
          <small>PREPARED CHANGE</small>
          <code><i>48</i> const res = await gateway.charge(req);</code>
          <code className="removed"><i>49</i> return ok(res);</code>
          <code className="added"><i>49+</i> if (res.status === 'ok') {'{'}</code>
          <code className="added"><i>50+</i>   return ok(res);</code>
          <code className="added"><i>51+</i> {'}'}</code>
          <code><i>52</i> throw new PaymentError(res.code);</code>
        </div>
        <div className="proof-checks">
          <small>VERIFICATION</small>
          {['Type check', 'Unit tests', 'Policy checks', 'Build'].map(item => <p key={item}><Check size={14}/>{item}</p>)}
          <small>EVIDENCE</small><p className="digest">sha256:8f3…7a</p><p className="digest">Ed25519 signed</p>
        </div>
      </div>
      <div className="proof-footer"><span>Prepared on a dedicated branch for your review.</span><span>Evidence ready <ArrowRight size={14}/></span></div>
    </div>
  );
}

export default function MarketingHome() {
  return (
    <div className="marketing-page">
      <header className="marketing-nav">
        <a href="/" aria-label="Software Oath home"><SoftwareOathLogo variant="full" size={34}/></a>
        <nav aria-label="Primary navigation"><a href="#product">Product</a><a href="#how">How it works</a><a href="#safety">Safety</a></nav>
        <a className="button button-outline" href="/dashboard">Open dashboard <ArrowRight size={16}/></a>
      </header>

      <main>
        <section className="marketing-hero">
          <div className="hero-copy">
            <h1 aria-label="Software that keeps its promises.">Software that<br/>keeps its promises.</h1>
            <p>Software Oath understands your repositories, prepares bounded repairs, proves every change, and leaves the final decision with you.</p>
            <div className="hero-actions"><a className="button button-primary" href="#product">Explore the product <ArrowRight size={17}/></a><a className="button button-outline" href="/dashboard">Open dashboard <ArrowRight size={17}/></a></div>
            <div className="hero-principles"><span>Evidence first</span><i/><span>Owner in control</span><i/><span>Nothing hidden</span></div>
          </div>
          <EvidencePreview />
        </section>

        <section className="product-section" id="product">
          <div className="section-intro"><h2>A complete system for responsible code stewardship.</h2><p>One evidence layer across maintenance, optimization, incident learning, and owner decisions.</p></div>
          <div className="product-rail">{products.map(({ icon: Icon, title, copy }) => <article key={title}><Icon size={26}/><h3>{title}</h3><p>{copy}</p><a href="#how">See how <ArrowRight size={14}/></a></article>)}</div>
        </section>

        <section className="workflow" id="how">
          <div className="workflow-heading"><h2>From repository signal to owner decision.</h2><p>A narrow, reviewable path—never an autonomous leap.</p></div>
          <div className="workflow-steps">{steps.map(([Icon, title, copy], index) => <article key={title}><div className="step-top"><span>{index + 1}</span><Icon size={24}/></div><h3>{title}</h3><p>{copy}</p>{index < steps.length - 1 ? <ArrowRight className="step-arrow" size={18}/> : null}</article>)}</div>
        </section>

        <section className="safety-section" id="safety">
          <div className="safety-intro"><h2>Safety by design.<br/>Always.</h2><p>Built for production realities, explicit authority, and strict accountability.</p></div>
          <div className="safety-rail">{safety.map(([Icon, title, copy]) => <article key={title}><Icon size={27}/><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>

        <section className="marketing-close"><CodeXml size={45}/><h2>Steward your software.<br/>Keep your promises.</h2><p>Give engineering teams leverage without giving up control.</p><a className="button button-primary" href="/dashboard">Open dashboard <ArrowRight size={17}/></a></section>
      </main>

      <footer className="marketing-footer"><SoftwareOathLogo variant="full" size={28}/><span>Evidence-backed repository stewardship.</span><nav><a href="#product">Product</a><a href="#how">How it works</a><a href="#safety">Safety</a></nav></footer>
    </div>
  );
}
