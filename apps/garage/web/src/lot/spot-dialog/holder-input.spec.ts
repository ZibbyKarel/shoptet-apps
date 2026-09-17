import { GUEST_HOLDER_VALUE, holderFormSchema, plateHintFor, toHolderInput } from './holder-input';

const OPTIONS = [
  { userId: 'u-1', name: 'Karel Zíbar', licensePlate: '4AB 1234' },
  { userId: 'u-2', name: 'Jana Nováková', licensePlate: null },
];

describe('holderFormSchema', () => {
  it('accepts a user holder with no plate typed', () => {
    expect(
      holderFormSchema.safeParse({ holderId: 'u-1', guestName: '', licensePlate: '' }).success
    ).toBe(true);
  });

  it('requires a guest name when the holder is a guest', () => {
    expect(
      holderFormSchema.safeParse({
        holderId: GUEST_HOLDER_VALUE,
        guestName: '   ',
        licensePlate: '',
      }).success
    ).toBe(false);
    expect(
      holderFormSchema.safeParse({
        holderId: GUEST_HOLDER_VALUE,
        guestName: 'Jan Host',
        licensePlate: '',
      }).success
    ).toBe(true);
  });

  it('rejects an empty holderId', () => {
    // `holderId: z.string().min(1)` — an empty value means the select was
    // somehow submitted with nothing chosen, which the form must refuse
    // rather than send on as an empty-string holder id.
    expect(
      holderFormSchema.safeParse({ holderId: '', guestName: '', licensePlate: '' }).success
    ).toBe(false);
  });

  it('carries a marker message, not Czech copy — the render translates it', () => {
    const failed = holderFormSchema.safeParse({
      holderId: GUEST_HOLDER_VALUE,
      guestName: '',
      licensePlate: '',
    });
    expect(failed.success).toBe(false);
    // A schema built at module level cannot call `t()`, and Czech copy frozen
    // into it would bypass the catalogue. But the message must be *present*, or
    // `FormField` forwards `undefined` and the field renders no error at all.
    expect(failed.success === false && failed.error.issues[0]?.path).toEqual(['guestName']);
    expect(failed.success === false && failed.error.issues[0]?.message).toBe('GUEST_NAME_REQUIRED');
  });
});

describe('toHolderInput', () => {
  it('maps a chosen user, trimming the plate', () => {
    expect(toHolderInput({ holderId: 'u-2', guestName: '', licensePlate: '  9XY 8765 ' })).toEqual({
      kind: 'USER',
      userId: 'u-2',
      licensePlate: '9XY 8765',
    });
  });

  it('sends no plate override when the field is blank', () => {
    expect(toHolderInput({ holderId: 'u-2', guestName: '', licensePlate: '   ' })).toEqual({
      kind: 'USER',
      userId: 'u-2',
      licensePlate: null,
    });
  });

  it('maps a guest, trimming the name', () => {
    expect(
      toHolderInput({ holderId: GUEST_HOLDER_VALUE, guestName: ' Jan Host ', licensePlate: '' })
    ).toEqual({ kind: 'GUEST', name: 'Jan Host', licensePlate: null });
  });
});

describe('plateHintFor', () => {
  it('is the chosen user’s stored plate', () => {
    expect(plateHintFor(OPTIONS, 'u-1')).toBe('4AB 1234');
  });

  it('is null for a user with no plate, and for a guest', () => {
    expect(plateHintFor(OPTIONS, 'u-2')).toBeNull();
    expect(plateHintFor(OPTIONS, GUEST_HOLDER_VALUE)).toBeNull();
  });

  it('is null for an id that is not in the list', () => {
    expect(plateHintFor(OPTIONS, 'u-gone')).toBeNull();
  });
});
