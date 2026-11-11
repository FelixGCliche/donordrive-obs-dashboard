/**
 * Raw DonorDrive Public API responses, trimmed from real Extra Life responses (API-Version 1.0,
 * November 2026). Field names, types and formats are kept as returned; names, messages, ids and
 * URLs are replaced with neutral placeholders.
 */

/** `GET /api/participants/{id}` */
export const rawParticipantFixture = {
  fundraisingGoal: 5000.0,
  eventName: 'Extra Life 2026',
  links: {
    donate: 'https://dd.extra-life.org/participants/example-streamer/donate',
    stream: 'https://www.youtube.com/watch?v=example',
    page: 'https://dd.extra-life.org/participants/example-streamer',
    facebookFundraiser: 'https://www.facebook.com/donate/0000000000000000',
  },
  hasActivityTracking: true,
  participantID: 500001,
  streamIsLive: true,
  numIncentives: 2,
  sumActivityUnits: 0.0,
  activityGoal: 100.0,
  isCustomAvatarImage: true,
  displayName: 'Example Streamer',
  streamingPlatform: 'YouTube',
  avatarImageURL: 'https://donordrivecontent.com/extralife/images/$avatars$/example.jpg',
  createdDateUTC: '2026-01-01T07:59:00.447+0000',
  numMilestones: 0,
  eventID: 562,
  sumDonations: 1234.56,
  streamIsEnabled: true,
  sumPledges: 0.0,
  streamingChannel: 'example-channel',
  participantTypeCode: 'P',
  numDonations: 4,
}

/** `GET /api/participants/{id}/donations?limit=50`, in API order (newest first) */
export const rawDonationsFixture = [
  {
    displayName: 'Donor One',
    donorID: '0000000000000001',
    links: {
      recipient: 'https://dd.extra-life.org/participants/500001',
      donate: 'https://dd.extra-life.org/participants/500001/donate',
    },
    isRegFee: false,
    eventID: 562,
    createdDateUTC: '2026-11-11T00:06:51.767+0000',
    recipientName: 'Example Streamer',
    recipientImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    message: 'Placeholder message one',
    participantID: 500001,
    amount: 70,
    avatarImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    donationID: 'A000000000000001',
  },
  {
    displayName: 'Donor Two',
    donorID: '0000000000000002',
    links: {
      recipient: 'https://dd.extra-life.org/participants/500001',
      donate: 'https://dd.extra-life.org/participants/500001/donate',
    },
    isRegFee: false,
    eventID: 562,
    createdDateUTC: '2026-11-10T22:15:03.2+0000',
    recipientName: 'Example Streamer',
    recipientImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    message: 'Placeholder hero request',
    participantID: 500001,
    amount: 25,
    avatarImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    donationID: 'A000000000000002',
    incentiveID: '00000000-0000-0000-0000000000000001',
  },
  {
    // Anonymous donor: no displayName, no donorID
    links: {
      recipient: 'https://dd.extra-life.org/participants/500001',
      donate: 'https://dd.extra-life.org/participants/500001/donate',
    },
    isRegFee: false,
    eventID: 562,
    createdDateUTC: '2026-11-09T00:47:08.17+0000',
    recipientName: 'Example Streamer',
    recipientImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    participantID: 500001,
    amount: 25,
    avatarImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    donationID: 'A000000000000003',
  },
  {
    // Hidden amount: the API omits `amount`
    displayName: 'Donor Four',
    donorID: '0000000000000004',
    links: {
      recipient: 'https://dd.extra-life.org/participants/500001',
      donate: 'https://dd.extra-life.org/participants/500001/donate',
    },
    isRegFee: false,
    eventID: 562,
    createdDateUTC: '2026-11-08T18:30:00.0+0000',
    recipientName: 'Example Streamer',
    recipientImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    message: null,
    participantID: 500001,
    avatarImageURL:
      'https://donordrivecontent.com/extralife/images/$avatars$/constituent_default_100.jpg',
    donationID: 'A000000000000004',
  },
]

/** `GET /api/participants/{id}/incentives`, in API order (cheapest first) */
export const rawIncentivesFixture = [
  {
    quantity: 5,
    amount: 25.0,
    description: 'Pick my next hero',
    incentiveImageURL: null,
    quantityClaimed: 1,
    fulfillmentNote: null,
    isExternalIncentive: false,
    links: {
      donate:
        'https://dd.extra-life.org/participants/500001/donate?incentiveID=00000000-0000-0000-0000000000000001',
    },
    isScheduled: false,
    isActive: true,
    incentiveID: '00000000-0000-0000-0000000000000001',
  },
  {
    quantity: 1,
    amount: 300.0,
    description: 'Placeholder challenge',
    incentiveImageURL: null,
    quantityClaimed: 0,
    fulfillmentNote: null,
    isExternalIncentive: false,
    links: {
      donate:
        'https://dd.extra-life.org/participants/500001/donate?incentiveID=00000000-0000-0000-0000000000000002',
    },
    isScheduled: true,
    startDateUTC: '2026-11-01T07:00:00.0+0000',
    endDateUTC: '2026-11-30T07:00:00.0+0000',
    isActive: true,
    incentiveID: '00000000-0000-0000-0000000000000002',
  },
]
