import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline-danger';
  children: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  children,
  className = '',
  ...props
}: ButtonProps) {
  const baseClasses =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-teal/40 disabled:cursor-not-allowed disabled:opacity-50';

  const variantClasses = {
    primary: 'bg-primary-teal text-white hover:bg-primary-teal/90',
    secondary:
      'border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    'outline-danger':
      'border border-red-600 bg-white text-red-600 hover:bg-red-700 hover:text-white dark:border-red-500 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-700 dark:hover:text-white',
  };

  return (
    <button className={`${baseClasses} ${variantClasses[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
