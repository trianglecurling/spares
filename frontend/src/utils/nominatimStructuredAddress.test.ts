import { describe, expect, test } from 'bun:test';
import { nominatimItemToStructuredAddress } from './nominatimStructuredAddress';

describe('nominatimItemToStructuredAddress', () => {
  test('maps house number and road to address line 1', () => {
    expect(
      nominatimItemToStructuredAddress({
        display_name: '100, East Main Street, Carrboro, North Carolina, 27510, United States',
        address: {
          house_number: '100',
          road: 'East Main Street',
          town: 'Carrboro',
          state: 'North Carolina',
          postcode: '27510',
          country: 'United States',
        },
      }),
    ).toEqual({
      addressLine1: '100 East Main Street',
      addressLine2: '',
      city: 'Carrboro',
      state: 'North Carolina',
      country: 'United States',
      postalCode: '27510',
    });
  });

  test('uses street when road is absent', () => {
    expect(
      nominatimItemToStructuredAddress({
        display_name: '742 Evergreen Terrace, Springfield, United States',
        address: {
          house_number: '742',
          street: 'Evergreen Terrace',
          city: 'Springfield',
          state: 'Illinois',
          postcode: '62704',
          country: 'United States',
        },
      }).addressLine1,
    ).toBe('742 Evergreen Terrace');
  });

  test('falls back to display name segments before the city when street fields are missing', () => {
    expect(
      nominatimItemToStructuredAddress({
        display_name: '2310, So-Hi Drive, Research Triangle Park, Durham, North Carolina, 27703, United States',
        address: {
          city: 'Durham',
          state: 'North Carolina',
          postcode: '27703',
          country: 'United States',
        },
      }),
    ).toEqual({
      addressLine1: '2310, So-Hi Drive, Research Triangle Park',
      addressLine2: '',
      city: 'Durham',
      state: 'North Carolina',
      country: 'United States',
      postalCode: '27703',
    });
  });

  test('does not invent a street line for city-only results', () => {
    expect(
      nominatimItemToStructuredAddress({
        display_name: 'Durham, North Carolina, 27701, United States',
        address: {
          city: 'Durham',
          state: 'North Carolina',
          postcode: '27701',
          country: 'United States',
        },
      }).addressLine1,
    ).toBe('');
  });
});
