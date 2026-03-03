export class GatewayError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

export class InsufficientCreditsError extends GatewayError {
  constructor(message: string) {
    super(message, 402);
    this.name = "InsufficientCreditsError";
  }
}

export class ConcurrencyLimitError extends GatewayError {
  constructor(message: string) {
    super(message, 429);
    this.name = "ConcurrencyLimitError";
  }
}

export class RateLimitError extends GatewayError {
  constructor(message: string) {
    super(message, 429);
    this.name = "RateLimitError";
  }
}

export class NoCapacityError extends GatewayError {
  readonly service: string;

  constructor(message: string, service: string) {
    super(message, 503);
    this.name = "NoCapacityError";
    this.service = service;
  }
}

export class PaymentError extends GatewayError {
  constructor(message: string) {
    super(message, 402);
    this.name = "PaymentError";
  }
}
