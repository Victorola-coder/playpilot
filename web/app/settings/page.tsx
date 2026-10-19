import { getRawRules } from '@/lib/playpilot';
import { Topbar } from '../topbar';
import { RulesEditor } from './rules-editor';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const { rules, error, isExample } = getRawRules();

  return (
    <>
      <Topbar current="settings" />
      <main className="page narrow">
        <section className="hero">
          <h1>Settings</h1>
          <p className="lead">
            Choose which songs PlayPilot saves and where they go. Changes are saved to <code>rules.json</code>, so the
            command line uses them too.
          </p>
        </section>

        {error ? (
          <div className="alert" role="alert">
            <span>
              {error} Fix the file by hand, or delete it to start again from the example rules.
            </span>
          </div>
        ) : (
          <RulesEditor initialRules={rules} isExample={isExample} />
        )}
      </main>
    </>
  );
}
