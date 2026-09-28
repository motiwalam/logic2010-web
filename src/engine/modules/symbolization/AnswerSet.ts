/** Port of AnswerSet.java: a problem's name and its answer records (one per answer tree). */
export interface AnswerSet {
  problemName: string | null;
  answers: string[] | null;
}
