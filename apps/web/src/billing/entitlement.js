import { billingApi } from './api.js';

// Thin client-side cache in front of GET /api/v1/entitlement. The frontend
// NEVER computes entitlement itself — it only renders whatever the server
// returns. This cache exists purely to avoid refetching on every click.
export const billing = {
  plans: [],
  entitlement: null,
  loading: false,
  device: null,

  async loadPlans() {
    const { plans } = await billingApi.getPlans();
    this.plans = plans;
    return plans;
  },

  async refreshEntitlement() {
    this.loading = true;
    try {
      this.entitlement = await billingApi.getEntitlement();
      return this.entitlement;
    } finally {
      this.loading = false;
    }
  },

  async getEntitlement({ forceRefresh = false } = {}) {
    if (!this.entitlement || forceRefresh) await this.refreshEntitlement();
    return this.entitlement;
  },
};
