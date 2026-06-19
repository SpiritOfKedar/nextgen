import { dark } from '@clerk/themes';
import nextgenLogo from '../assets/nextgen-logo.png';

export const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: '#00e599',
    colorPrimaryForeground: '#09090b',
    colorBackground: '#09090b',
    colorForeground: '#ffffff',
    colorMutedForeground: '#a1a1aa',
    colorMuted: '#18181b',
    colorInput: '#18181b',
    colorInputForeground: '#ffffff',
    colorBorder: '#27272a',
    colorNeutral: '#27272a',
    colorRing: '#00e599',
    colorModalBackdrop: 'rgba(0, 0, 0, 0.6)',
    fontFamily: "'Inter', sans-serif",
    fontFamilyButtons: "'Inter', sans-serif",
    borderRadius: '0.75rem',
  },
  options: {
    logoImageUrl: nextgenLogo,
    logoLinkUrl: '/',
    logoPlacement: 'inside',
    socialButtonsVariant: 'blockButton',
    socialButtonsPlacement: 'top',
  },
  elements: {
    rootBox: {
      width: '100%',
    },
    card: {
      backgroundColor: '#09090b',
      border: '1px solid #27272a',
      borderRadius: '0.75rem',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    },
    header: {
      gap: '0.75rem',
    },
    headerTitle: {
      fontFamily: "'Outfit', sans-serif",
      fontWeight: '700',
      fontSize: '1.25rem',
      letterSpacing: '-0.02em',
    },
    headerSubtitle: {
      color: '#a1a1aa',
      fontSize: '0.875rem',
    },
    logoBox: {
      height: '2rem',
      marginBottom: '0.25rem',
    },
    logoImage: {
      height: '2rem',
    },
    socialButtonsBlockButton: {
      backgroundColor: '#18181b',
      border: '1px solid #3f3f46',
      color: '#e4e4e7',
      borderRadius: '0.5rem',
      '&:hover': {
        backgroundColor: '#27272a',
        borderColor: '#52525b',
      },
    },
    dividerLine: {
      backgroundColor: '#27272a',
    },
    dividerText: {
      color: '#71717a',
      fontSize: '0.75rem',
    },
    formFieldLabel: {
      color: '#e4e4e7',
      fontSize: '0.875rem',
      fontWeight: '500',
    },
    formFieldInput: {
      backgroundColor: '#18181b',
      border: '1px solid #3f3f46',
      borderRadius: '0.5rem',
      color: '#ffffff',
      '&:focus': {
        borderColor: '#00e599',
        boxShadow: '0 0 0 1px #00e599',
      },
    },
    formButtonPrimary: {
      backgroundColor: '#00e599',
      color: '#09090b',
      borderRadius: '9999px',
      fontWeight: '600',
      fontSize: '0.875rem',
      boxShadow: 'none',
      '&:hover': {
        backgroundColor: '#00b377',
      },
    },
    footerActionLink: {
      color: '#00e599',
      fontWeight: '500',
      '&:hover': {
        color: '#00b377',
      },
    },
    footerActionText: {
      color: '#71717a',
    },
    identityPreviewEditButton: {
      color: '#00e599',
    },
    formResendCodeLink: {
      color: '#00e599',
    },
    otpCodeFieldInput: {
      borderColor: '#3f3f46',
      '&:focus': {
        borderColor: '#00e599',
      },
    },
    modalBackdrop: {
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    modalContent: {
      borderRadius: '0.75rem',
    },
    navbarButton: {
      color: '#a1a1aa',
    },
    alertText: {
      color: '#a1a1aa',
    },
  },
};

export const clerkLocalization = {
  signIn: {
    start: {
      title: 'Sign in to NextGen',
      subtitle: 'Welcome back! Continue building with AI.',
    },
  },
  signUp: {
    start: {
      title: 'Create your NextGen account',
      subtitle: 'Start building apps with AI — no setup required.',
    },
  },
};
