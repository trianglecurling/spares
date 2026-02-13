import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Button from '../components/Button';

export default function RequestSpareConfirm() {
  const navigate = useNavigate();

  const handleCancel = () => {
    // Prefer going back to wherever they came from; fall back to dashboard.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-[#121033] dark:text-gray-100">
            Did you check with who&apos;s on bye?
          </h1>
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
      </div>
    </Layout>
  );
}
