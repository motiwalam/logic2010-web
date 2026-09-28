package edu.ucla.phil.logic;

import java.awt.Component;
import java.awt.Dimension;
import java.awt.Frame;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.util.Hashtable;
import java.util.Vector;
import javax.swing.JFrame;

/**
 * Oracle shadow of MessageDialog: builds the same content and buttons, runs the same handlers,
 * but instead of showing itself it hands itself to OracleDialogs, which records it and answers
 * as the test script says.
 */
class MessageDialog extends BaseDialog implements LogicConstants, ActionListener {
   static JFrame hiddenOwner = null;
   boolean disposeOwner;
   boolean restoreLocation;
   boolean sizeSet;
   boolean packOnShow = false;
   int selectedButton;
   ActionButton[] buttons;
   Component content;
   Vector handlers;
   static Hashtable savedBounds = new Hashtable();
   String boundsKey;
   /** The text of a message window (showMessage). */
   String messageText;
   int defaultButton = -1;

   MessageDialog(Frame frame, String s, Component component, String[] astring) {
      super(frame, s, true);
      this.selectedButton = -1;
      this.content = component;
      this.add(component);
      if (astring == null) {
         this.buttons = null;
      } else {
         this.buttons = new ActionButton[astring.length];
         for (int i = 0; i < this.buttons.length; i++) this.buttons[i] = new ActionButton(astring[i]);
      }
      this.handlers = null;
      this.boundsKey = null;
   }

   static synchronized Frame resolveOwner(Frame frame, String s) { return frame; }
   static synchronized void disposeHiddenOwner() { }
   public void setSize(Dimension dimension) { this.sizeSet = true; }
   @Override public void actionPerformed(ActionEvent actionevent) { }
   void setButtons(ActionButton[] aactionbutton) { this.buttons = aactionbutton; }
   void setDefaultButtonIndex(int i) { this.defaultButton = i; }

   void addHandler(DialogHandler dialoghandler) {
      if (dialoghandler != null) {
         if (this.handlers == null) this.handlers = new Vector();
         this.handlers.addElement(dialoghandler);
      }
   }

   void setButtonTip(String s, String s1) { }
   void setBoundsKey(String s) { this.boundsKey = s; }
   String getBoundsKey() { return this.boundsKey; }
   void forgetSavedBounds() { }
   Rectangle getSavedBounds() { return null; }

   static Point centeredLocation(Dimension dimension) { return new Point(0, 0); }

   void showAt(Point point) { this.showAt(point, false); }

   void showAt(Point point, boolean flag) { OracleDialogs.show(this); }

   void showModeless(Point point, boolean flag) { OracleDialogs.show(this); }

   void close() { }

   /** A button is pressed: whether the dialog closes (the handlers accept). */
   boolean press(int i) {
      this.selectedButton = i;
      return this.selectedButton >= this.buttons.length || this.runHandlers();
   }

   boolean runHandlers() {
      int i = this.handlers == null ? 0 : this.handlers.size();
      boolean flag = true;
      for (int j = 0; j < i; j++) flag &= ((DialogHandler)this.handlers.elementAt(j)).handleChoice(this);
      return flag;
   }

   boolean fillFieldsAndChoose(Vector vector, EditableTextPane[] aeditabletextpane, int i) {
      int j = vector == null ? 0 : vector.size();
      int k = aeditabletextpane == null ? 0 : aeditabletextpane.length;
      if (k < j) j = k;
      k -= j;
      for (int l = 0; l < j; l++) {
         aeditabletextpane[l].setText((String)vector.elementAt(0));
         vector.removeElementAt(0);
         aeditabletextpane[l].select(0, 2147483647);
      }
      if (k == 0 && i != -1) {
         this.selectedButton = i;
         return this.runHandlers();
      } else {
         return false;
      }
   }

   static void showMessage(String s, String s1, Point point, DialogHandler dialoghandler) {
      String[] astring = new String[]{"OK"};
      int i = 0;
      if (dialoghandler != null) {
         astring = dialoghandler.getLabels();
         i = dialoghandler.getDefaultIndex();
      }
      MessageDialog messagedialog = new MessageDialog(null, s, new javax.swing.JPanel(), astring);
      messagedialog.messageText = s1;
      messagedialog.addHandler(dialoghandler);
      messagedialog.setDefaultButtonIndex(i);
      messagedialog.showAt(point);
   }

   static void showMessage(Message message, Hashtable hashtable, Point point, DialogHandler dialoghandler) {
      String s = message.text;
      if (hashtable != null) s = Message.substitute(s, hashtable);
      showMessage(message.id, s, point, dialoghandler);
   }

   static BaseDialog showNotice(Message message, Hashtable hashtable) {
      String s = message.text;
      if (hashtable != null) s = Message.substitute(s, hashtable);
      MessageDialog d = new MessageDialog(null, message.id, new javax.swing.JPanel(), new String[0]);
      d.messageText = s;
      OracleDialogs.show(d);
      return d;
   }

   static void closeNotice(BaseDialog basedialog) { }

   static void showScrollingMessage(String s, String s1, Rectangle rectangle, DialogHandler dialoghandler) {
      showMessage(s, s1, null, dialoghandler);
   }
}
