import {
  experienceLabel,
  financialAssistanceLabel,
  guardianName,
  icePrivilegesChoiceLabel,
  membershipOptInLabel,
  nameTagPronounsLabel,
  nameTagReplacementLabel,
  reciprocalDiscountLabel,
  studentDiscountLabel,
  type RegistrationCollectedDetailsFields,
} from './registrationCollectedDetailsShared';

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <p>
      {label}: {value}
    </p>
  );
}

export default function RegistrationCollectedDetails({
  fields,
}: {
  fields: RegistrationCollectedDetailsFields;
}) {
  const studentDiscount = studentDiscountLabel(fields);
  const reciprocalDiscount = reciprocalDiscountLabel(fields);
  const assistance = financialAssistanceLabel(fields.financialAssistance);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <DetailItem label="Ice privileges" value={icePrivilegesChoiceLabel(fields.icePrivilegesChoice)} />
      <DetailItem
        label="Curling experience"
        value={experienceLabel(fields.experienceType, fields.experienceSelfReportedYears)}
      />
      {studentDiscount ? <DetailItem label="Student discount" value={studentDiscount} /> : null}
      {reciprocalDiscount ? <DetailItem label="Reciprocal discount" value={reciprocalDiscount} /> : null}
      <DetailItem label="USA Curling membership" value={membershipOptInLabel(fields.usaCurlingMembershipOptIn)} />
      <DetailItem label="USWCA membership" value={membershipOptInLabel(fields.uswcaMembershipOptIn)} />
      <DetailItem label="Name on name tag" value={fields.nameTagName?.trim() || 'Not collected'} />
      <DetailItem label="Name tag pronouns" value={nameTagPronounsLabel(fields.nameTagIncludePronouns)} />
      <DetailItem
        label="Replacement name tags"
        value={nameTagReplacementLabel(fields.nameTagReplacementQuantity)}
      />
      {fields.basicIceFallbackInterest === true ? (
        <DetailItem
          label="Basic ice fallback"
          value="Yes, if no leagues can be placed"
        />
      ) : fields.basicIceFallbackInterest === false ? (
        <DetailItem label="Basic ice fallback" value="No" />
      ) : null}
      {assistance ? <DetailItem label="Financial assistance" value={assistance} /> : null}
      {fields.guardian ? (
        <>
          <DetailItem label="Parent or guardian" value={guardianName(fields.guardian)} />
          {fields.guardian.email ? <DetailItem label="Guardian email" value={fields.guardian.email} /> : null}
          {fields.guardian.phone ? <DetailItem label="Guardian phone" value={fields.guardian.phone} /> : null}
        </>
      ) : null}
    </div>
  );
}
