const USER_MUTATION_LOCK_NAMESPACE = 84623158;

export class MutationBusyError extends Error {
  constructor() {
    super('Một thay đổi khác trên tài khoản đang được xử lý. Vui lòng thử lại.');
    this.code = 'MUTATION_BUSY';
  }
}

export const acquireUserMutationLock = async (tx, userId, isPg) => {
  if (!isPg) return;
  const result = await tx.getOne(
    'SELECT pg_try_advisory_xact_lock(?, ?) AS acquired',
    [USER_MUTATION_LOCK_NAMESPACE, userId]
  );
  if (result?.acquired !== true) throw new MutationBusyError();
};
