import '@testing-library/jest-dom';
import { mockedT } from './testing/mock-translations';

jest.mock('next-intl', () => ({
  ...jest.requireActual('next-intl'),
  useTranslations: () => mockedT,
}));
