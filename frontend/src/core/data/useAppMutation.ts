import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useLocale } from '../i18n/index';
import { errorMessage } from './error-message';

export interface AppMutationOptions<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** Prefix query cần tải lại sau khi thành công (vd. `['cache']`). */
  invalidate?: QueryKey[];
  /** Thông báo thành công (đã dịch); bỏ trống = thông báo mặc định. `false` = không báo. */
  success?: string | false | ((data: TData, vars: TVars) => string);
  /** Tiêu đề thông báo lỗi (đã dịch). */
  error?: string;
  onSuccess?: (data: TData, vars: TVars) => void;
}

/** Mutation chuẩn: toast kết quả + làm mới dữ liệu liên quan. */
export function useAppMutation<TVars = void, TData = unknown>(opts: AppMutationOptions<TVars, TData>) {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  return useMutation<TData, unknown, TVars>({
    mutationFn: opts.mutationFn,
    onSuccess: (data, vars) => {
      if (opts.success !== false) {
        toast.success(typeof opts.success === 'function' ? opts.success(data, vars) : (opts.success ?? t('ui.toast.done')));
      }
      for (const key of opts.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(data, vars);
    },
    onError: (err) => {
      toast.error(opts.error ?? t('ui.toast.failed'), { description: errorMessage(err) });
    },
  });
}
