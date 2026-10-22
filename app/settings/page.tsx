import { Suspense } from "react";
import { GmailSettings } from "@/components/gmail-settings";

function SettingsFallback() {
  return <section className="workflow-card" aria-busy="true"><p className="eyebrow">ACCOUNT SETTINGS</p><h2>Loading Gmail settings…</h2></section>;
}

async function SettingsContents({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const params = await searchParams;
  return <>
    <div className="welcome-row"><div><p className="eyebrow">ACCOUNT SETTINGS</p><h1>Settings</h1><p className="welcome-copy">Connect Gmail for a manually confirmed test send.</p></div></div>
    <GmailSettings oauthResult={params.gmail} />
  </>;
}

export default function SettingsPage(props: { searchParams: Promise<{ gmail?: string }> }) {
  return <Suspense fallback={<SettingsFallback />}><SettingsContents {...props} /></Suspense>;
}
