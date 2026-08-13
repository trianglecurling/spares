import { useCallback, useEffect, useId, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppPageControlsRow from '../components/AppPageControlsRow';
import AppStateCard from '../components/AppStateCard';
import BackButton from '../components/BackButton';
import ChoiceInput from '../components/ChoiceInput';
import FormField from '../components/FormField';
import VolunteerProgramShiftsBody, {
  type VolunteerProgramGroupBy,
} from '../components/volunteering/VolunteerProgramShiftsBody';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import { get } from '../api/client';
import { useAlert } from '../contexts/AlertContext';
import { formatApiError } from '../utils/api';
import {
  formatProgramShiftDateSpan,
  volunteerProgramHasOpenShifts,
  type VolunteerProgramView,
} from '../utils/volunteering';

export default function VolunteerProgramPage() {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const groupById = useId();
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [program, setProgram] = useState<VolunteerProgramView | null>(null);
  const [groupBy, setGroupBy] = useState<VolunteerProgramGroupBy>('shift');

  const slug = slugParam?.trim() || '';

  const load = useCallback(async () => {
    if (!slug) {
      setNotFound(true);
      setProgram(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const data = (await get('/volunteering/programs/{slug}', undefined, {
        slug,
      })) as { program: VolunteerProgramView };
      setProgram(data.program);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setNotFound(true);
        setProgram(null);
      } else {
        showAlert(formatApiError(err, 'Failed to load volunteer program'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [slug, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <AppPage>
        <AppPageHeader
          title="Volunteer program"
          description="Loading program details."
          actions={<BackButton label="Back to volunteering hub" to="/volunteering" />}
        />
        <AppStateCard title="Loading program" description="Fetching shifts and signup options." />
      </AppPage>
    );
  }

  if (notFound || !program) {
    return (
      <AppPage>
        <AppPageHeader
          title="Volunteer program"
          description="This program is unavailable."
          actions={<BackButton label="Back to volunteering hub" to="/volunteering" />}
        />
        <AppStateCard
          title="Program not found"
          description="This volunteer program may be unpublished, archived, or no longer available."
        />
      </AppPage>
    );
  }

  if (slug !== program.slug) {
    return <Navigate to={`/volunteering/programs/${program.slug}`} replace />;
  }

  const hasShifts = volunteerProgramHasOpenShifts(program);
  const shiftless = program.roles.length === 0 && !hasShifts;

  return (
    <AppPage>
      <AppPageHeader
        title={program.title}
        description={hasShifts ? formatProgramShiftDateSpan(program.shifts) : undefined}
        actions={<BackButton label="Back to volunteering hub" to="/volunteering" />}
      />

      <div className="space-y-4">
        <div className="app-card space-y-3 p-5">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
            {program.location ? <span>{program.location}</span> : null}
            <span>Contact: {program.pointOfContact}</span>
          </div>
          {program.description ? <ArticleMarkdown markdown={program.description} /> : null}
        </div>

        {hasShifts ? (
          <>
            <AppPageControlsRow
              left={
                <FormField label="Group by" htmlFor={groupById} className="mb-0">
                  <ChoiceInput<VolunteerProgramGroupBy>
                    inputId={groupById}
                    listboxLabel="Group by"
                    layout="inline"
                    name="volunteer-program-group-by"
                    options={[
                      { value: 'shift', label: 'Shift time' },
                      { value: 'role', label: 'Role' },
                    ]}
                    value={groupBy}
                    onChange={(v) => {
                      if (v === 'shift' || v === 'role') setGroupBy(v);
                    }}
                  />
                </FormField>
              }
            />
            <div className="app-card space-y-4 p-5">
              <VolunteerProgramShiftsBody program={program} groupBy={groupBy} onChanged={load} />
            </div>
          </>
        ) : shiftless ? null : (
          <AppStateCard
            title="No upcoming shifts"
            description="There are no upcoming shifts to sign up for in this program right now."
          />
        )}
      </div>
    </AppPage>
  );
}
