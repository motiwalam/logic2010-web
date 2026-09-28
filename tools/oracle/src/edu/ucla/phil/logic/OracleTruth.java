package edu.ucla.phil.logic;

import java.awt.event.ActionEvent;
import java.util.*;

/**
 * Oracle for the Truth Tables module (src/engine/modules/truth): for every problem of the
 * notation (and a few extra statements), generated work records (correct tables, wrong and
 * missing cells, answers, counterexample rows, setup codes, "taut"), checked with various
 * option settings on one module instance, edits of tree nodes (error counts) and commits;
 * and setup-stage sequences. Prints JSON; the test replays the same steps.
 *   OracleTruth
 */
public class OracleTruth {
   static StringBuilder out = new StringBuilder();
   static Random rnd = new Random(5);

   static String q(Object o) { return Oracle.q(o); }

   static final String[] EXTRA = {"P", "~P->P", "P&Q . P->R .: R|S", "(P<->Q)<->(Q<->P)", "P . Q . R . S .: T|U", "P->Q . Q .: P", "~(P&~P)"};

   public static void main(String[] args) throws Exception {
      java.io.PrintStream stdout = System.out;
      System.setOut(System.err);
      Oracle.init();
      if (!LPTruthAnalysis.getExercises()) throw new IllegalStateException("exercises");
      LPTruthAnalysis m = new LPTruthAnalysis(false);
      List<String[]> problems = new ArrayList<>();
      for (int i = 0; i < LPTruthAnalysis.exercises.size(); i++) {
         TaggedRecord t = new TaggedRecord(LPTruthAnalysis.exercises.getRecordAt(i));
         String st = LPTruthAnalysis.getProblemStatement(t);
         if (st != null) problems.add(new String[]{t.getName(), st});
      }
      for (int i = 0; i < EXTRA.length; i++) problems.add(new String[]{"Extra " + i, EXTRA[i]});
      out.append("{\"options\":[");
      for (int i = 0; i < LPTruthAnalysis.exercises.size(); i++) {
         TaggedRecord t = new TaggedRecord(LPTruthAnalysis.exercises.getRecordAt(i));
         for (int pr = 0; pr < 2; pr++) {
            LPTruthAnalysis x = pr == 0 ? m : new LPTruthAnalysis(true);
            x.loadExerciseInfo(t);
            boolean[] b = {x.completeAllNodes, x.completeAllRows, x.completeAllWffs, x.completeSetup, x.checkDisabled, x.treeErrorsDisabled,
               x.tableErrorsDisabled, x.setupErrorsDisabled, x.checkMessagesDisabled, x.dontChange, x.assumeTautology};
            StringBuilder bits = new StringBuilder();
            for (boolean z : b) bits.append(z ? '1' : '0');
            out.append(i + pr == 0 ? "" : ",").append('[').append(q(t.getName())).append(',').append(pr == 1).append(',').append(q(bits)).append(',').append(q(x.titlePanel.getNote())).append(']');
         }
      }
      out.append("],\n\"cases\":[");
      boolean first = true;
      for (String[] p : problems) {
         int n = 20;
         for (int c = 0; c < n; c++) {
            if (!first) out.append(",\n");
            first = false;
            oneCase(m, p[0], p[1], c);
         }
      }
      out.append("],\n\"setup\":[");
      first = true;
      for (int k = 0; k < problems.size(); k += 2) {
         String[] p = problems.get(k);
         if (!first) out.append(",\n");
         first = false;
         setupCase(m, p[0], p[1]);
      }
      out.append("]}\n");
      stdout.print(out);
      stdout.flush();
      System.exit(0);
   }

   /** The node values (preorder) of a cell's tree, true values for the row. */
   static List<TruthValueTree> nodes(TruthValueTree t) {
      List<TruthValueTree> l = new ArrayList<>();
      l.add(t);
      for (int i = 0; i < t.getChildTreeCount(); i++) l.addAll(nodes(t.getChildTree(i)));
      return l;
   }

   static String rightValues(LPTruthAnalysis m, TruthTableCell cell, int row) {
      TruthProblemPanel p = m.problem;
      String rs = TruthTableGrid.rowAssignmentString(row, p.letterCount);
      boolean[] a = new boolean[p.letterCount];
      for (int k = 0; k < a.length; k++) a[k] = rs.charAt(k) == 'T';
      StringBuilder b = new StringBuilder();
      for (TruthValueTree n : nodes(cell.valueTree)) {
         Expression e = n.getExpression();
         b.append(e == null ? '?' : (p.evaluator.evaluate(e, a) ? 'T' : 'F'));
      }
      return b.toString();
   }

   static char flip(char c) { return c == 'T' ? 'F' : 'T'; }

   static String genCell(String right, double bad) {
      int mode = rnd.nextDouble() >= bad ? 0 : 5 + rnd.nextInt(5);
      char[] v = right.toCharArray();
      char sign = '+';
      if (mode < 5) {
         // correct
      } else if (mode < 7) {
         int k = rnd.nextInt(v.length);
         v[k] = flip(v[k]);
         sign = '-';
      } else if (mode < 9) {
         for (int k = 0; k < v.length; k++) if (rnd.nextInt(3) == 0) v[k] = '?';
      } else {
         return rnd.nextBoolean() ? "+?" : "";
      }
      if (rnd.nextInt(10) == 0) sign = sign == '+' ? '-' : '+';
      String value = String.valueOf(v[0]);
      if (rnd.nextInt(12) == 0) value = rnd.nextBoolean() ? "?" : String.valueOf(flip(right.charAt(0)));
      return new String(v) + sign + value;
   }

   static String genRecord(LPTruthAnalysis m, String name, String statement, int c) {
      TruthProblemPanel p = m.problem;
      StringBuilder r = new StringBuilder();
      r.append(TaggedRecord.formatField(name, '$')).append(TaggedRecord.formatField(statement, '='));
      double pRow = c == 0 ? 1.0 : new double[]{1.0, 0.8, 0.4, 0.1}[rnd.nextInt(4)];
      double bad = new double[]{0, 0, 0.03, 0.3}[rnd.nextInt(4)];
      int rows = p.table.rowCount;
      List<Integer> counter = new ArrayList<>();
      for (int i = 0; i < rows; i++) {
         TruthTableCell[] cells = p.table.cells[i];
         String[] right = new String[cells.length];
         for (int k = 0; k < cells.length; k++) right[k] = rightValues(m, cells[k], i);
         boolean ce = right[cells.length - 1].charAt(0) == 'F';
         for (int k = 0; k < cells.length - 1; k++) if (right[k].charAt(0) == 'F') ce = false;
         if (ce) counter.add(i);
         if (rnd.nextDouble() >= pRow) continue;
         StringBuilder row = new StringBuilder(TruthTableGrid.rowAssignmentString(i, p.letterCount));
         for (int k = 0; k < cells.length; k++) {
            String code = c == 0 ? right[k] + "+" + right[k].charAt(0) : genCell(right[k], bad);
            row.append(k == 0 ? ':' : '.').append(code);
         }
         if (bad > 0 && rnd.nextInt(30) == 0) row.append(".TT+T");
         r.append(TaggedRecord.formatField(rnd.nextInt(20) == 0 ? row.toString().toLowerCase() : row.toString(), '@'));
      }
      boolean valid = counter.isEmpty();
      int answer = c == 0 || rnd.nextInt(10) < 6 ? (valid ? 0 : 1) : rnd.nextInt(3) - 1;
      int ce;
      if (answer == 1) ce = counter.isEmpty() || rnd.nextInt(10) >= 6 ? (rows == 0 || rnd.nextInt(10) == 0 ? -1 : rnd.nextInt(rows)) : counter.get(rnd.nextInt(counter.size()));
      else ce = c == 0 || rows == 0 || rnd.nextInt(10) < 7 ? -1 : rnd.nextInt(rows);
      if (ce != -1) r.append(ce).append("`#");
      if (answer != -1) r.append(answer).append("`*");
      if (c > 0 && rnd.nextInt(4) == 0) r.append("taut`%");
      if (c > 0 && rnd.nextInt(3) == 0) r.append(TaggedRecord.formatField(genSetup(p), '&'));
      if (rnd.nextInt(5) == 0) r.append(rnd.nextInt(9)).append("`e");
      if (rnd.nextInt(5) == 0) r.append(rnd.nextInt(900)).append("`t");
      return TaggedRecord.toLine(r.toString());
   }

   static String genSetup(TruthProblemPanel p) {
      List<String> letters = new ArrayList<>();
      for (Object o : p.evaluator.sentenceLetters) letters.add(o.toString());
      int kind = rnd.nextInt(5);
      if (kind == 1) Collections.shuffle(letters, rnd);
      if (kind == 2 && !letters.isEmpty()) letters.set(rnd.nextInt(letters.size()), rnd.nextBoolean() ? "X" : "&&");
      String s = String.join(".", letters);
      if (kind == 0 || kind == 2 && rnd.nextBoolean()) return s;
      int n = letters.size();
      int rows = n == 0 ? 0 : 1 << n;
      StringBuilder b = new StringBuilder(s).append(':');
      int len = rnd.nextInt(3) == 0 ? rnd.nextInt(rows * n + 2) : rows * n;
      for (int i = 0; i < len; i++) {
         int row = i / Math.max(n, 1), j = i % Math.max(n, 1);
         char right = ((row >> (n - j - 1)) & 1) == 0 ? 'T' : 'F';
         int x = rnd.nextInt(12);
         b.append(x < 9 ? right : x == 9 ? flip(right) : x == 10 ? '?' : 'z');
      }
      return b.toString();
   }

   static String snapshot(LPTruthAnalysis m) {
      StringBuilder b = new StringBuilder();
      TruthTableGrid g = m.problem.table;
      for (int i = 0; i < g.rowCount; i++) {
         for (TruthTableCell cell : g.cells[i]) {
            b.append(cell.getText()).append(cell.isWrong ? '-' : '+').append(cell.getCode()).append('|').append(cell.getTreeCode()).append('|');
            for (TruthValueTree n : nodes(cell.valueTree)) b.append(n.errorShown ? 'e' : '.').append(n.correct ? 'c' : 'x').append(n.label.valueButton.isLocked() ? 'L' : 'u');
            b.append(';');
         }
         b.append('\n');
      }
      return b.toString();
   }

   static void setFlags(LPTruthAnalysis m, int f) {
      m.completeAllRows = (f & 1) != 0;
      m.completeAllWffs = (f & 2) != 0;
      m.completeSetup = (f & 4) != 0;
      m.completeAllNodes = (f & 8) != 0;
      m.treeErrorsDisabled = (f & 16) != 0;
      m.checkMessagesDisabled = true;
      m.errorCount = 0;
   }

   static String check(LPTruthAnalysis m) {
      try {
         ErrorRef e = m.checkFull();
         return e.id + "/" + (e.params == null ? null : e.params.get("summary"));
      } catch (RuntimeException x) {
         return "X:" + x.getClass().getSimpleName();
      }
   }

   static void oneCase(LPTruthAnalysis m, String name, String statement, int c) {
      setFlags(m, 0);
      m.problem.loadProblem(new TaggedRecord(TaggedRecord.formatField(name, '$') + TaggedRecord.formatField(statement, '=')));
      String rec = genRecord(m, name, statement, c);
      int state;
      try { state = LPTruthAnalysis.getProblemState(rec); } catch (RuntimeException x) { state = -9; }
      out.append("{\"rec\":").append(q(rec)).append(",\"state\":").append(state).append(",\"combos\":[");
      int[] combos = {0, rnd.nextInt(32), rnd.nextInt(32)};
      for (int k = 0; k < combos.length; k++) {
         setFlags(m, combos[k]);
         m.problem.loadProblem(new TaggedRecord(rec));
         if (k > 0) out.append(',');
         out.append("{\"flags\":").append(combos[k]).append(",\"check\":").append(q(check(m))).append(",\"work\":").append(q(m.problem.getWorkRecord()))
            .append(",\"hasWork\":").append(m.hasWork()).append(",\"showing\":").append(m.problem.mainPanel.isAncestorOf(m.problem.table));
         if (k == 0) out.append(",\"cells\":").append(q(snapshot(m)));
         out.append('}');
      }
      out.append("],\"edits\":[");
      // edits on the last combo's load: set unlocked nodes, then commit the cell
      TruthTableGrid g = m.problem.table;
      int edits = g.rowCount == 0 ? 0 : rnd.nextInt(5);
      for (int k = 0; k < edits; k++) {
         int row = rnd.nextInt(g.rowCount), col = rnd.nextInt(g.cells[row].length);
         TruthTableCell cell = g.cells[row][col];
         List<TruthValueTree> ns = nodes(cell.valueTree);
         List<Integer> free = new ArrayList<>();
         for (int i = 0; i < ns.size(); i++) if (!ns.get(i).label.valueButton.isLocked()) free.add(i);
         if (free.isEmpty()) continue;
         int node = free.get(rnd.nextInt(free.size()));
         int value = rnd.nextInt(3) - 1;
         ns.get(node).label.valueButton.setSelectedIndex(value);
         boolean commit = rnd.nextBoolean();
         if (commit) cell.commitTreeValue();
         if (k > 0 && out.charAt(out.length() - 1) != '[') out.append(',');
         out.append("[").append(row).append(',').append(col).append(',').append(node).append(',').append(value).append(',').append(commit)
            .append(',').append(m.errorCount).append(',').append(q(cell.getCode())).append(',').append(q(cell.getTreeCode())).append(']');
      }
      out.append("],\"after\":").append(q(check(m) + "#" + m.problem.getWorkRecord())).append('}');
   }

   static void setupCase(LPTruthAnalysis m, String name, String statement) {
      setFlags(m, 4);
      m.problem.loadProblem(new TaggedRecord(TaggedRecord.formatField(name, '$') + TaggedRecord.formatField(statement, '=')));
      TruthTableSetupPanel sp = m.problem.setupPanel;
      List<String> letters = new ArrayList<>();
      for (Object o : m.problem.evaluator.sentenceLetters) letters.add(LogicProgram.translateSymbols(o.toString(), LogicConstants.maggie, LogicProgram.symbols));
      out.append("{\"name\":").append(q(name)).append(",\"statement\":").append(q(statement)).append(",\"steps\":[");
      boolean first = true;
      for (int attempt = 0; attempt < 4; attempt++) {
         String lt, rt;
         int kind = attempt == 3 ? 0 : rnd.nextInt(6);
         List<String> l = new ArrayList<>(letters);
         if (kind == 1) Collections.shuffle(l, rnd);
         if (kind == 2 && !l.isEmpty()) l.remove(0);
         if (kind == 3 && !l.isEmpty()) l.add(l.get(0));
         if (kind == 4) l.add(rnd.nextBoolean() ? "Q&&" : "Z");
         lt = String.join(rnd.nextBoolean() ? "." : " . ", l);
         int rows = letters.isEmpty() ? 0 : 1 << letters.size();
         rt = kind == 5 ? String.valueOf(rows + 1) : rnd.nextInt(8) == 0 ? " " + rows : String.valueOf(rows);
         sp.lettersField.setText(lt);
         sp.rowCountField.setText(rt);
         String id = pressOk(m);
         if (!first) out.append(',');
         first = false;
         out.append("[\"L\",").append(q(lt)).append(',').append(q(rt)).append(',').append(q(id)).append(',').append(m.problem.setupButtons.stage)
            .append(',').append(q(m.problem.getWorkRecord())).append(']');
         if (sp.lettersEntered) break;
      }
      for (int attempt = 0; attempt < 3 && sp.lettersEntered; attempt++) {
         StringBuilder ch = new StringBuilder();
         for (int i = 0; i < sp.rowCount; i++) {
            for (int j = 0; j < sp.letterCount; j++) {
               ChoiceButton b = (ChoiceButton) sp.rowPanels[i].getComponent(j);
               int right = (Integer) b.getUserData();
               int x = attempt == 2 ? 0 : rnd.nextInt(10);
               int v = x < 8 ? right : x == 8 ? 1 - right : -1;
               b.setSelectedIndex(v);
               ch.append(v + 1);
            }
         }
         String id = pressOk(m);
         out.append(",[\"A\",").append(q(ch.toString())).append(',').append(q(id)).append(',').append(q(m.problem.getWorkRecord())).append(',').append(q(check(m)))
            .append(',').append(m.problem.setupDone).append(']');
         if (m.problem.setupDone) break;
      }
      out.append("],\"final\":").append(q(check(m) + "#" + m.problem.getWorkRecord() + "#" + LPTruthAnalysis.getProblemState(m.saveProblem()))).append('}');
   }

   /** The setup OK button: its check's error id, then the button's action (messages disabled). */
   static String pressOk(LPTruthAnalysis m) {
      TruthSetupButtons b = m.problem.setupButtons;
      String id;
      if (b.stage == 0) {
         ErrorRef e = m.problem.setupPanel.checkLettersAndRows();
         id = e.id + "/" + e.params.get("summary") + "/" + e.params.get("sentence") + "/" + e.params.get("unparsed");
      } else {
         ErrorRef e = m.problem.setupPanel.checkAssignments();
         id = e.id + "/" + e.params.get("summary");
      }
      b.actionPerformed(new ActionEvent(b.okButton, 0, "OK"));
      return id;
   }
}
