export interface CongressBillListItem {
  congress?: number | string;
  latestAction?: {
    actionDate?: string;
    text?: string;
  };
  number?: string | number;
  originChamber?: string;
  policyArea?: {
    name?: string;
  };
  sponsors?: Array<{
    bioguideId?: string;
    firstName?: string;
    fullName?: string;
    lastName?: string;
    party?: string;
    state?: string;
  }>;
  title?: string;
  type?: string;
  updateDate?: string;
  url?: string;
}

export interface CongressBillDetailPayload {
  bill?: {
    constitutionalAuthorityStatementText?: string;
    congress?: number | string;
    introducedDate?: string;
    latestAction?: {
      actionDate?: string;
      text?: string;
    };
    number?: string | number;
    originChamber?: string;
    policyArea?: {
      name?: string;
    };
    relatedBills?: {
      count?: number;
      url?: string;
    };
    sponsors?: Array<{
      bioguideId?: string;
      firstName?: string;
      fullName?: string;
      lastName?: string;
      party?: string;
      state?: string;
      url?: string;
    }>;
    committees?: {
      count?: number;
      url?: string;
    };
    titles?: Array<{
      title?: string;
      titleType?: string;
    }>;
    type?: string;
    updateDate?: string;
  };
}

export interface CongressBillActionPayload {
  actions?: Array<{
    actionDate?: string;
    text?: string;
    type?: string;
  }>;
}

export interface CongressBillTextPayload {
  textVersions?: Array<{
    date?: string;
    type?: string;
    formats?: Array<{
      type?: string;
      url?: string;
    }>;
  }>;
}

export interface CongressMemberListItem {
  bioguideId?: string;
  depiction?: {
    imageUrl?: string;
  };
  district?: number | string;
  firstName?: string;
  honorificName?: string;
  invertedOrderName?: string;
  lastName?: string;
  partyName?: string;
  state?: string;
  terms?: {
    item?: Array<{
      chamber?: string;
      district?: number | string;
      memberType?: string;
      startYear?: number | string;
      endYear?: number | string;
    }>;
  };
  updateDate?: string;
}

export interface CongressMemberDetailPayload {
  member?: CongressMemberListItem & {
    addressInformation?: {
      officeAddress?: string;
      phoneNumber?: string;
    };
    cosponsoredLegislation?: {
      count?: number;
    };
    sponsoredLegislation?: {
      count?: number;
    };
  };
}

export interface CongressCommitteeListItem {
  chamber?: string;
  name?: string;
  systemCode?: string;
  updateDate?: string;
}

export interface CongressCommitteeDetailPayload {
  committee?: CongressCommitteeListItem & {
    bills?: {
      count?: number;
      url?: string;
    };
    history?: Array<{
      officialName?: string;
    }>;
    jurisdiction?: string;
    subcommittees?: Array<{
      name?: string;
      systemCode?: string;
    }>;
  };
}
