export interface UseCaseContract<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}
