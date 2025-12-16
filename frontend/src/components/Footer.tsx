import { Link } from 'react-router-dom';

interface FooterProps {
  simple?: boolean;
}

export default function Footer({ simple = false }: FooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 dark:text-gray-400 space-y-4 md:space-y-0">
          <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-6">
            <span>&copy; {year} Triangle Curling Club</span>
            <a 
              href="https://trianglecurling.com" 
              className="hover:text-primary-teal transition-colors"
            >
              trianglecurling.com
            </a>
          </div>

          <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-6">
            <Link 
              to="/help" 
              className="hover:text-primary-teal transition-colors"
            >
              Help
            </Link>
            <a 
              href="https://links.tccnc.club/privacy" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-primary-teal transition-colors"
            >
              Privacy Policy
            </a>
            {!simple && (
              <>
                <a 
                  href="https://links.tccnc.club/leagues" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hover:text-primary-teal transition-colors"
                >
                  League Info
                </a>
                <a 
                  href="mailto:av@trianglecurling.com" 
                  className="hover:text-primary-teal transition-colors"
                >
                  Report Issues
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}

