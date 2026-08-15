export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class GateViolation extends DomainError {}

export class InvalidTransition extends DomainError {}

export class PermissionDenied extends DomainError {}

export class NotFoundError extends DomainError {}
