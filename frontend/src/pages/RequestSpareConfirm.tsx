import { useNavigate } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../components/AppPage';
import Button from '../components/Button';

export default function RequestSpareConfirm() {
  const navigate = useNavigate();

  const handleCancel = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <>
      <AppPage narrow>
        <div className="app-card">
          <AppPageHeader title="Did you check with who's on bye?" />
          <p className="text-gray-600 dark:text-gray-400 mt-3">
            Before requesting a spare, please check with the players in your league who are on bye
            for that game! If you need help, contact your league coordinator.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row sm:justify-end gap-3">
            <Button type="button" variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={() => navigate('/request-spare/new')}>
              Yes, request a spare
            </Button>
          </div>
        </div>
      </AppPage>
    </>
  );
}
