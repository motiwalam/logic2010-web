package edu.ucla.phil.logic;

import java.awt.Component;
import java.awt.Container;
import java.util.ArrayList;
import java.util.List;
import javax.swing.AbstractButton;
import javax.swing.JLabel;
import javax.swing.text.JTextComponent;

/**
 * Records the dialogs the derivation code opens (through the shadowed MessageDialog) and answers
 * them from a script. Each dialog is recorded as {kind, title, texts, buttons, answer, ...}; kind
 * is the DerivationDialogs (or BoundVariableMap) method that opened it, or "message".
 *
 * Answers: "cancel" (the default), "choice:K" (select radio K, press OK), "text:A|B" (fill the
 * editable fields, press OK), "select:S,E" (select S..E in the formula field, press OK),
 * "button:N". A press the handlers refuse is recorded and followed by a cancel.
 */
class OracleDialogs {
   static List<String> answers = new ArrayList<>();
   static List<StringBuilder> entries = new ArrayList<>();
   static StringBuilder current;
   /** The entries as a JSON array body. */
   static String log() {
      StringBuilder b = new StringBuilder();
      for (int i = 0; i < entries.size(); i++) b.append(i > 0 ? "," : "").append(entries.get(i));
      return b.toString();
   }

   static void reset(List<String> script) {
      answers = new ArrayList<>(script);
      entries = new ArrayList<>();
   }

   static String kind() {
      StackTraceElement[] st = Thread.currentThread().getStackTrace();
      for (StackTraceElement e : st) {
         String c = e.getClassName();
         String m = e.getMethodName();
         if (c.endsWith(".DerivationDialogs") && !m.equals("showMessage") && !m.equals("termSelectionQuery")) return m;
         if (c.endsWith(".BoundVariableMap") && m.equals("renameBinders")) return "renameBinders";
      }
      return "other";
   }

   static void show(MessageDialog d) {
      String kind = d.messageText != null ? "message" : kind();
      List<String> texts = new ArrayList<>();
      if (d.messageText != null) texts.add(LogicProgram.expandEscapes(d.messageText));
      else scrape(d.content, texts);
      List<String> buttons = new ArrayList<>();
      if (d.buttons != null) for (ActionButton b : d.buttons) buttons.add(b.getText());
      String answer = answers.isEmpty() ? "cancel" : answers.remove(0);
      StringBuilder log = new StringBuilder();
      entries.add(log);
      StringBuilder outer = current;
      current = log;
      log.append("{\"kind\":").append(Oracle.q(kind)).append(",\"title\":").append(Oracle.q(d.title))
         .append(",\"texts\":").append(arr(texts)).append(",\"buttons\":").append(arr(buttons))
         .append(",\"answer\":").append(Oracle.q(answer));
      boolean closed = apply(d, answer);
      log.append(",\"closed\":").append(closed).append(",\"selected\":").append(d.selectedButton).append('}');
      current = outer;
   }

   static boolean apply(MessageDialog d, String answer) {
      if (answer.equals("cancel")) {
         d.selectedButton = -1;
         return true;
      }
      if (answer.startsWith("choice:")) {
         int k = Integer.parseInt(answer.substring(7));
         List<AbstractButton> radios = new ArrayList<>();
         collectRadios(d.content, radios);
         for (int i = 0; i < radios.size(); i++) radios.get(i).setSelected(i == k);
         return pressOrCancel(d, 0);
      }
      if (answer.startsWith("text:")) {
         String[] values = answer.substring(5).split("\\|", -1);
         List<JTextComponent> fields = new ArrayList<>();
         collectEditable(d.content, fields);
         for (int i = 0; i < values.length && i < fields.size(); i++) fields.get(i).setText(values[i]);
         return pressOrCancel(d, 0);
      }
      if (answer.startsWith("select:")) {
         String[] se = answer.substring(7).split(",");
         List<JTextComponent> fields = new ArrayList<>();
         collectText(d.content, fields);
         JTextComponent f = fields.get(fields.size() - 1);
         f.select(Integer.parseInt(se[0]), Integer.parseInt(se[1]));
         return pressOrCancel(d, 0);
      }
      if (answer.startsWith("place:")) {
         String[] se = answer.substring(6).split(",");
         TermOccurrenceSelector sel = findSelector(d.content);
         for (int i = 0; i + 1 < se.length; i += 2) {
            sel.select(Integer.parseInt(se[i]), Integer.parseInt(se[i + 1]));
            sel.insertAtCaret(SchematicLetter.placeholder(0));
         }
         current.append(",\"placed\":").append(Oracle.q(sel.getText()));
         return pressOrCancel(d, 0);
      }
      if (answer.startsWith("button:")) return pressOrCancel(d, Integer.parseInt(answer.substring(7)));
      d.selectedButton = -1;
      return true;
   }

   static boolean pressOrCancel(MessageDialog d, int i) {
      boolean ok = d.press(i);
      if (!ok) {
         current.append(",\"refused\":true");
         d.selectedButton = -1;
      }
      return ok;
   }

   static void scrape(Component c, List<String> texts) {
      if (c == null || c instanceof javax.swing.JScrollBar || !c.isVisible() && !(c instanceof JTextComponent)) return;
      if (c instanceof JTextComponent) {
         texts.add(((JTextComponent)c).getText());
         return;
      }
      if (c instanceof AbstractButton) {
         String t = ((AbstractButton)c).getText();
         texts.add(t == null || t.isEmpty() ? "( )" : "( ) " + t);
         return;
      }
      if (c instanceof JLabel) {
         texts.add(((JLabel)c).getText());
         return;
      }
      if (c instanceof Container) for (Component k : ((Container)c).getComponents()) scrape(k, texts);
   }

   static TermOccurrenceSelector findSelector(Component c) {
      if (c instanceof TermOccurrenceSelector) return (TermOccurrenceSelector)c;
      if (c instanceof Container) for (Component k : ((Container)c).getComponents()) {
         TermOccurrenceSelector t = findSelector(k);
         if (t != null) return t;
      }
      return null;
   }

   static void collectRadios(Component c, List<AbstractButton> out) {
      if (c instanceof AbstractButton) out.add((AbstractButton)c);
      else if (c instanceof Container) for (Component k : ((Container)c).getComponents()) collectRadios(k, out);
   }

   static void collectEditable(Component c, List<JTextComponent> out) {
      if (c instanceof JTextComponent) {
         if (((JTextComponent)c).isEditable()) out.add((JTextComponent)c);
      } else if (c instanceof Container) for (Component k : ((Container)c).getComponents()) collectEditable(k, out);
   }

   static void collectText(Component c, List<JTextComponent> out) {
      if (c instanceof JTextComponent) out.add((JTextComponent)c);
      else if (c instanceof Container) for (Component k : ((Container)c).getComponents()) collectText(k, out);
   }

   static String arr(List<String> l) {
      StringBuilder b = new StringBuilder("[");
      for (int i = 0; i < l.size(); i++) b.append(i > 0 ? "," : "").append(Oracle.q(l.get(i)));
      return b.append(']').toString();
   }
}
