import { getExcluded, getOverview, getRawRules } from '@/lib/playpilot';
import { Topbar } from '../topbar';
import { ExcludedList } from './excluded-list';
import { RulesEditor } from './rules-editor';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const { rules, settings, error, isExample } = getRawRules();
  const { total, unmeasured } = getOverview();

  return (
    <>
      <Topbar current="settings" />
      <main className="page narrow">
        <section className="hero">
          <h1>Settings</h1>
          <p className="lead">
            Decide what counts as a song you love, and where PlaylistPilot saves it. Changes are saved to{' '}
            <code>rules.json</code>, so the command line uses them too.
          </p>
        </section>

        {error ? (
          <div className="alert" role="alert">
            <span>{error} Fix the file by hand, or delete it to start again from the example rules.</span>
          </div>
        ) : (
          <RulesEditor
            initialRules={rules}
            initialSettings={settings}
            isExample={isExample}
            unmeasured={{ total, unmeasured }}
          />
        )}

        <ExcludedList songs={getExcluded()} />
      </main>
    </>
  );
}
