package edu.ucla.phil.logic;

import java.awt.HeadlessException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Oracle for the Recognition module (tests/fixtures/recognition):
 *
 * - checks: for every recognition exercise and every answer (every rule name, None, empty,
 *   garbage, theorem names, the key's and near-miss names, case variants), a real
 *   LPRecognition window's checkProblem: result, verdict, comment, status, the work record
 *   and the state of that record (LPRecognition.getProblemState); also the active rules;
 * - user: loadUserProblem for arguments and malformed variants (a message dialog, which
 *   headless AWT refuses, is recorded as "dialog").
 */
public class OracleRecognition {
   static List<String> comments = new ArrayList<>();

   /** The index of a comment text in the fixture's "comments" table. */
   static int comment(String s) {
      int i = comments.indexOf(s);
      if (i == -1) { comments.add(s); i = comments.size() - 1; }
      return i;
   }

   public static void main(String[] args) throws Exception {
      Oracle.init();
      Oracle.quiet(() -> LPRecognition.getExercises());
      StringBuilder out = new StringBuilder("{\"checks\":[\n");
      List<String> ruleAnswers = new ArrayList<>();
      for (Object o : LogicProgram.ruleTable.ruleNames) ruleAnswers.add((String) o);
      String[] extra = {"", "  ", "NONE", "none", "None ", "garbage", "T1", "T5", "T100", "t2", "TH1", "mp", "Mt", " MP ", "EI", "EG", "AV", "AV3", "UI", "QN"};
      LPRecognition m = new LPRecognition(false);
      int n = LPRecognition.exercises.size();
      List<String> users = new ArrayList<>();
      for (int p = 0; p < n; p++) {
         String record = LPRecognition.exercises.getRecordAt(p);
         TaggedRecord t = new TaggedRecord(record);
         Set<String> answers = new LinkedHashSet<>(ruleAnswers);
         for (String e : extra) answers.add(e);
         for (char tag : new char[]{'@', '~'}) {
            String v = t.valueAt(t.indexOfTag(tag));
            if (v != null) for (String a : v.split("\\.")) { answers.add(a.trim()); answers.add(a.trim().toLowerCase()); }
         }
         String statement = LPRecognition.getProblemStatement(t);
         if (statement != null) {
            users.add(statement);
            users.add(statement.replace(".", ". ."));
            users.add(". " + statement + " .");
            users.add(statement.replace(".:", "."));
            int c = statement.indexOf(".:");
            if (c != -1) users.add(statement.substring(c + 2));
            users.add(statement.replace("->", "->)"));
         }
         m.loadProblem(record);
         out.append(p == 0 ? "" : ",\n").append("{\"record\":").append(Oracle.q(record));
         out.append(",\"activeRules\":").append(Oracle.q(m.activeRules.toString())).append(",\"activeRange\":").append(Oracle.q(m.activeRange.toString()));
         out.append(",\"checkDisabled\":").append(m.checkDisabled).append(",\"results\":[");
         boolean first = true;
         for (String a : answers) {
            m.loadProblem(record);
            m.problem.ruleField.setText(a);
            String result;
            try {
               boolean ok = m.checkProblem();
               String work = m.saveProblem();
               work = TaggedRecord.stripTimestamp(work);
               String expected = TaggedRecord.toLine(TaggedRecord.formatField(t.getName(), '$') + TaggedRecord.formatField(statement, '=')
                  + TaggedRecord.formatField(a.trim().isEmpty() ? null : a.trim(), '*'));
               result = "[" + Oracle.q(a) + "," + ok + "," + Oracle.q(m.problem.verdictLabel.getText()) + "," + comment(m.problem.commentText.getText())
                  + "," + Oracle.q(m.titlePanel.getStatus()) + "," + (work.equals(expected) ? "1" : Oracle.q(work)) + "," + LPRecognition.getProblemState(work) + "]";
            } catch (Throwable x) {
               result = "[" + Oracle.q(a) + "," + Oracle.q("X:" + x.getClass().getSimpleName()) + "]";
            }
            out.append(first ? "" : ",\n  ").append(result);
            first = false;
         }
         out.append("]}");
      }
      out.append("\n],\"user\":[\n");
      users.add("P");
      users.add("P .");
      users.add(".: P");
      users.add("P . Q");
      users.add("");
      users.add("P .. Q .: R");
      users.add("P . . . Q . .: R");
      users.add("P&Q .: P");
      users.add("P && Q .: P");
      for (int i = 0; i < users.size(); i++) {
         String s = users.get(i);
         String r;
         try {
            m.loadUserProblem(s);
            r = Oracle.q(m.saveProblem().replaceAll("[0-9]+`t$", ""));
         } catch (HeadlessException x) {
            r = Oracle.q("dialog");
         } catch (Throwable x) {
            r = Oracle.q("X:" + x.getClass().getSimpleName());
         }
         out.append(i == 0 ? "" : ",\n").append("[").append(Oracle.q(s)).append(",").append(r).append(",").append(Oracle.q(ArgumentParser.normalizeDots(s))).append("]");
      }
      out.append("\n],\"comments\":[");
      for (int i = 0; i < comments.size(); i++) out.append(i == 0 ? "" : ",\n").append(Oracle.q(comments.get(i)));
      out.append("]}\n");
      System.out.print(out);
   }
}
