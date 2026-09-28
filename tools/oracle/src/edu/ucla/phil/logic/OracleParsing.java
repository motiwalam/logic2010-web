package edu.ucla.phil.logic;

import java.io.BufferedReader;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Oracle for the Parsing module (tests/fixtures/parsing).
 *
 *   OracleParsing trees <formula-inputs.txt>   parse trees of texts (one JSON string per line)
 *   OracleParsing work                         simulated student work on every exercise
 *
 * trees: for every parsing exercise and every corpus text: notation code, structure string,
 * and each tree node's displayed text and operator ranges (ParseTreeFormulaText.getOperatorRanges),
 * in pre-order.
 *
 * work: for each exercise, under several option settings, a random sequence of actions on a
 * real LPParsing window (notation choices, clicks, checks); after each action a snapshot of
 * the window's state. A click is ParseTreeFormulaText.mousePressed with the pixel test
 * replaced by the character index (x inside character j <=> index j), and without the flash
 * (it paints and sleeps). Loading a record with a main-connective selection replays
 * loadRecord's `*` part here, as its setHighlight needs a displayed component.
 */
public class OracleParsing {
   static StringBuilder out = new StringBuilder();

   public static void main(String[] args) throws Exception {
      Oracle.init();
      Oracle.quiet(() -> LPParsing.getExercises());
      if (args[0].equals("trees")) trees(args[1]);
      else work();
      System.out.print(out);
   }

   static void trees(String inputs) throws Exception {
      List<String> texts = new ArrayList<>();
      for (int j = 0; j < LPParsing.exercises.size(); j++) texts.add(LPParsing.getProblemStatement(LPParsing.exercises.getRecordAt(j)));
      try (BufferedReader r = new BufferedReader(new FileReader(inputs))) {
         String line;
         while ((line = r.readLine()) != null) texts.add(unjson(line));
      }
      LPParsing m = new LPParsing(false);
      out.append("[\n");
      for (int i = 0; i < texts.size(); i++) {
         String s = texts.get(i);
         out.append(i == 0 ? "" : ",\n").append("{\"s\":").append(Oracle.q(s));
         try {
            FormulaParseNode f = new FormulaParseNode(s);
            String code = f.getNotationCode();
            String struct = f.getStructureString();
            m.loadProblem(TaggedRecord.toLine(TaggedRecord.formatField(s, '=')));
            StringBuilder nodes = new StringBuilder();
            walk(m.problem.treePanel.rootNode, nodes);
            out.append(",\"code\":").append(Oracle.q(code)).append(",\"struct\":").append(Oracle.q(struct));
            out.append(",\"nodes\":[").append(nodes).append("]");
         } catch (Throwable t) {
            out.append(",\"error\":").append(Oracle.q(t.getClass().getSimpleName()));
         }
         out.append("}");
      }
      out.append("\n]\n");
   }

   static void walk(ParseTreeNodePanel p, StringBuilder b) {
      if (b.length() != 0) b.append(",");
      b.append("[").append(Oracle.q(p.formulaText.getText())).append(",").append(Oracle.q(p.formulaText.getOperatorRanges().toString())).append("]");
      for (int k = 0; k < p.getChildNodeCount(); k++) walk(p.getChildNode(k), b);
   }

   static String unjson(String line) {
      line = line.trim();
      StringBuilder b = new StringBuilder();
      for (int i = 1; i < line.length() - 1; i++) {
         char c = line.charAt(i);
         if (c == '\\') {
            char d = line.charAt(++i);
            switch (d) {
               case 'n': b.append('\n'); break;
               case 't': b.append('\t'); break;
               case 'r': b.append('\r'); break;
               case 'u': b.append((char) Integer.parseInt(line.substring(i + 1, i + 5), 16)); i += 4; break;
               default: b.append(d);
            }
         } else b.append(c);
      }
      return b.toString();
   }

   // ---- work ----

   static final String[] SCENARIOS = {"default", "autoCheck", "mainOnly", "autoCheck+mainOnly", "noCheck"};

   static void work() {
      out.append("[\n");
      boolean first = true;
      Random random = new Random(2010);
      ProblemSelector all = new ProblemSelector("~{}");
      for (int sc = 0; sc < SCENARIOS.length; sc++) {
         LPParsing.resetOptions();
         Oracle.quiet(() -> { LPParsing.readOptions(LogicProgram.openDataFile("options", false)); LPParsing.logNeeds(); });
         if (SCENARIOS[sc].contains("autoCheck")) LPParsing.autoCheck = all;
         if (SCENARIOS[sc].contains("mainOnly")) LPParsing.mainOnly = all;
         if (SCENARIOS[sc].equals("noCheck")) LPParsing.noCheck = all;
         int n = LPParsing.exercises.size();
         for (int p = 0; p < n; p++) {
            if (sc != 0 && p % 3 != sc % 3) continue;
            String record = LPParsing.exercises.getRecordAt(p);
            out.append(first ? "" : ",\n").append("{\"scenario\":").append(Oracle.q(SCENARIOS[sc])).append(",\"record\":").append(Oracle.q(record)).append(",\"steps\":[");
            first = false;
            LPParsing m = new LPParsing(false);
            load(m, record);
            out.append("{\"a\":[\"load\"],\"s\":").append(snapshot(m)).append("}");
            int count = 4 + random.nextInt(12);
            for (int k = 0; k < count; k++) {
               String action = act(m, random);
               out.append(",\n {\"a\":").append(action).append(",\"s\":").append(snapshot(m)).append("}");
            }
            // the saved record, loaded into a new window
            String saved = TaggedRecord.stripTimestamp(m.saveProblem());
            LPParsing m2 = new LPParsing(false);
            load(m2, saved);
            out.append(",\n {\"a\":[\"reload\",").append(Oracle.q(saved)).append("],\"s\":").append(snapshot(m2)).append("}");
            out.append("],\"state\":").append(LPParsing.getProblemState(saved)).append("}");
         }
      }
      out.append("\n]\n");
   }

   static void load(LPParsing m, String record) {
      TaggedRecord t = new TaggedRecord(record);
      String sel = t.valueAt(t.indexOfTag('*'));
      if (sel == null) {
         m.loadProblem(record);
         return;
      }
      t.removeField(t.indexOfTag('*'));
      m.loadProblem(t.toString());
      // ParsingProblemPanel.loadRecord's `*` part, without setHighlight
      m.noDescent = true;
      ParseTreeFormulaText ft = m.problem.treePanel.rootNode.formulaText;
      ft.selectionCorrect = sel.charAt(0) == 'T';
      List<Integer> v = new ArrayList<>();
      DelimitedTokenizer d = new DelimitedTokenizer("\\,");
      d.setInput(sel.substring(1));
      Integer x;
      while ((x = LogicProgram.parseInteger(d.nextToken())) != null) v.add(x);
      if (v.isEmpty()) ft.selectedRange = null;
      else {
         int[] a = new int[v.size()];
         for (int k = 0; k < a.length; k++) a[k] = v.get(k);
         ft.selectedRange = a;
      }
   }

   static String act(LPParsing m, Random random) {
      int r = random.nextInt(10);
      if (r < 2) {
         int i = random.nextInt(10) < 7 ? NotationChooser.indexForCode(new FormulaParseNode(m.problem.statement).getNotationCode()) : random.nextInt(3);
         if (i < 0) i = 2;
         select(m, i);
         return "[\"notation\"," + i + "]";
      }
      if (r < 3) {
         ErrorRef e = m.problem.checkProblem();
         if (!m.checkDisabled) m.titlePanel.setStatus((String) e.params.get("summary"));
         return "[\"check\"," + Oracle.q(e.id) + "," + Oracle.q(e.params.get("summary")) + "]";
      }
      if (r == 3 && random.nextInt(4) == 0) {
         m.removeWork();
         return "[\"removeWork\"]";
      }
      // a click on a visible node
      List<ParseTreeNodePanel> visible = new ArrayList<>();
      List<String> paths = new ArrayList<>();
      visibleNodes(m.problem.treePanel.rootNode, "", visible, paths);
      int k = random.nextInt(visible.size());
      ParseTreeNodePanel p = visible.get(k);
      String text = p.formulaText.getText();
      IntervalSet ops = p.formulaText.getOperatorRanges();
      int j;
      if (random.nextInt(10) < 6 && ops.count >= 2) {
         int b = 2 * random.nextInt(ops.count / 2);
         j = ops.boundaries[b] + random.nextInt(Math.max(1, ops.boundaries[b + 1] - ops.boundaries[b]));
      } else {
         j = random.nextInt(text.length() + 2) - 1;
      }
      click(m, p, j);
      return "[\"click\",[" + paths.get(k) + "]," + j + "]";
   }

   static void select(LPParsing m, int i) {
      m.problem.notationChooser.buttons[i].setSelected(true);
   }

   static void visibleNodes(ParseTreeNodePanel p, String path, List<ParseTreeNodePanel> nodes, List<String> paths) {
      nodes.add(p);
      paths.add(path);
      if (p.expanded) {
         for (int k = 0; k < p.getChildNodeCount(); k++) visibleNodes(p.getChildNode(k), path.isEmpty() ? "" + k : path + "," + k, nodes, paths);
      }
   }

   /** ParseTreeFormulaText.mousePressed at character j (see the class comment). */
   static void click(LPParsing m, ParseTreeNodePanel p, int j) {
      ParseTreeFormulaText ft = p.formulaText;
      if ("N".equals(m.problem.notationChooser.getSelectedCode())) return;
      boolean hit = ft.parseNode != null && ft.parseNode.getChildCount() != 0 && ft.getOperatorRanges().contains(j);
      String s = ft.getText();
      int[] range = j < 0 || j >= s.length() || s.charAt(j) == ' ' ? null : LogicProgram.symbolBoundsAt(s, j, LogicProgram.symbols);
      if (m.noDescent) {
         ft.selectionCorrect = hit;
         ft.selectedRange = range;
      } else if (!p.expanded && hit) {
         p.setExpanded(!p.expanded);
         ft.selectedRange = range;
      } else {
         ft.selectedRange = range;
         m.errorCount++;
      }
   }

   static String snapshot(LPParsing m) {
      ParsingProblemPanel pp = m.problem;
      ParseTreePanel tp = pp.treePanel;
      ParseTreeFormulaText ft = tp.rootNode.formulaText;
      StringBuilder b = new StringBuilder("{");
      b.append("\"notation\":").append(pp.notationChooser.getSelectedIndex());
      b.append(",\"result\":").append(Oracle.q(pp.notationChooser.resultLabel.getText()));
      b.append(",\"statusLabel\":").append(Oracle.q(tp.statusLabel.getText()));
      b.append(",\"visible\":").append(tp.isVisible());
      b.append(",\"status\":").append(Oracle.q(m.titlePanel.getStatus()));
      b.append(",\"errors\":").append(m.errorCount);
      b.append(",\"unexpanded\":").append(tp.unexpandedCount);
      b.append(",\"complete\":").append(tp.isComplete());
      b.append(",\"noDescent\":").append(m.noDescent);
      b.append(",\"checkNow\":").append(m.checkNow);
      b.append(",\"selected\":").append(ft.selectedRange == null ? "null" : Oracle.q(java.util.Arrays.toString(ft.selectedRange)));
      b.append(",\"selectionCorrect\":").append(ft.selectionCorrect);
      b.append(",\"work\":").append(Oracle.q(pp.getWorkRecord()));
      return b.append("}").toString();
   }
}
